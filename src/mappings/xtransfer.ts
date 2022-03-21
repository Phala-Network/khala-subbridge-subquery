import { U256 } from '@polkadot/types'
import { IEvent } from '@polkadot/types/types'
import { SubstrateEvent } from '@subql/types'
import { AccountId, MultiLocation } from "@polkadot/types/interfaces"
import { CurrencyId } from "@acala-network/types/interfaces"
import { CurrencyDeposit, XTokenSent } from '../types'

export async function handleXTokenTransferredEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [sender, currencyId, amount, dest],
    } = ctx.event as unknown as IEvent<[AccountId, CurrencyId, U256, MultiLocation]>

    const blockHeight = ctx.block.block.header.number.toBigInt()
    const txId = ctx.extrinsic?.idx
    const id = `${blockHeight}-${txId}-${amount}`

    if (undefined === (await XTokenSent.get(id))) {
        const record = new XTokenSent(id)
        record.createdAt = ctx.block.timestamp
        record.currencyId = currencyId.toString()
        record.amount = amount.toBigInt()
        record.sender = sender.toString()
        record.hash = ctx.extrinsic?.extrinsic.hash.toHex()

        // Decode from MultiLocatioin
        if (
            dest.interior.isX4
            && dest.interior.asX4[0].isParachain
            && dest.interior.asX4[0].asParachain.unwrap().toString() === '2004'
            && dest.interior.asX4[1].isGeneralKey
            && dest.interior.asX4[1].asGeneralKey.toString() === '0x6362'   // characters: 'cb'
            && dest.interior.asX4[2].isGeneralIndex
            && dest.interior.asX4[3].isGeneralKey
        ) {
            record.isX3 = true
            record.destChain = dest.interior.asX4[2].asGeneralIndex.unwrap().toBigInt()
            // Solo chain account
            record.recipient = dest.interior.asX4[3].asGeneralKey.toString()
        } else if (
            dest.interior.isX2
            && dest.interior.asX2[0].isParachain
            && dest.interior.asX2[0].asParachain.unwrap().toString() === '2004'
            && dest.interior.asX2[1].isAccountId32
        ) {
            record.isX3 = false
            record.destChain = undefined
            // Substrate account
            record.recipient = dest.interior.asX2[1].asAccountId32.toString()
        } else {
            // Unrecognised format
            return;
        }

        await record.save()
        logger.trace(`Created new XTokenSent record: ${record}`)
    }
}

export async function handleCurrencyDepositedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [currencyId, recipient, amount],
    } = ctx.event as unknown as IEvent<[CurrencyId, AccountId, U256]>

    const blockHeight = ctx.block.block.header.number.toBigInt()
    const txId = ctx.extrinsic?.idx
    const id = `${blockHeight}-${txId}-${amount}`

    let record = await CurrencyDeposit.get(id)
    if (record === undefined) {
        record = new CurrencyDeposit(id)
        record.createdAt = ctx.block.timestamp
        record.currencyId = currencyId.toString()
        record.recipient = recipient.toString()
        record.amount = amount.toBigInt()

        await record.save()
        logger.trace(`Created new CurrencyDeposit record: ${record}`)
    }
}
