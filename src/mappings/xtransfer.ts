import { encodeAddress } from '@polkadot/util-crypto'
import { Bytes, decorateStorage, U256 } from '@polkadot/types'
import { IEvent } from '@polkadot/types/types'
import { SubstrateEvent } from '@subql/types'
import { AccountId } from "@polkadot/types/interfaces"
import { XcmV1MultiAsset, XcmV1MultiLocation } from '@polkadot/types/lookup'

import { BridgeChainId, DepositNonce, ResourceId } from '../interfaces'
import { BridgeOutboundingRecord, BridgeInboundingRecord, Tx, XcmTransfered, XcmDeposited, XcmWithdrawn } from '../types'

export async function handleFungibleTransferEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec, resourceId, amount, recipient],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce, ResourceId, U256, Bytes]>

    const chainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${chainId}-${depositNonce}`

    if (undefined === (await BridgeOutboundingRecord.get(id))) {
        const record = new BridgeOutboundingRecord(id)
        record.createdAt = ctx.block.timestamp
        record.destChainId = chainId
        record.depositNonce = depositNonce
        record.resourceId = resourceId.toHex()
        record.amount = amount.toBigInt()
        record.recipient = recipient.toHex()
        record.sender = ctx.extrinsic?.extrinsic.isSigned ? ctx.extrinsic?.extrinsic.signer.toString() : undefined

        let txId = ctx.extrinsic?.extrinsic.hash.toHex()
        let sendTx = new Tx(txId)
        sendTx.hash = ctx.extrinsic?.extrinsic.hash.toHex()
        sendTx.sender = ctx.extrinsic?.extrinsic.signer.toString()
        await sendTx.save()

        record.sendTx = txId
        await record.save()
        logger.debug(`Created new outbounding record: ${record}`)
    }
}

export async function handleProposalVoteForEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec, _voter],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce, AccountId]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await BridgeInboundingRecord.get(id)
    if (record === undefined) {
        record = new BridgeInboundingRecord(id)
        record.createdAt = ctx.block.timestamp
        record.originChainId = originChainId
        record.depositNonce = depositNonce
        record.resourceId = ctx.extrinsic?.extrinsic.args[2].toHex()
        record.status = 'Initiated'
        record.voteTxs = []
        logger.debug(`Created new inbounding record: ${record}`)
    }

    let txId = ctx.extrinsic.extrinsic.hash.toHex()
    let voteTx = new Tx(txId)
    voteTx.hash = ctx.extrinsic.extrinsic.hash.toHex()
    voteTx.sender = ctx.extrinsic?.extrinsic.signer.toString()
    await voteTx.save()

    let votes = record.voteTxs
    votes.push(txId)
    record.voteTxs = votes
    await record.save()
    logger.debug(`Add new vote into inbounding record: ${record}`)
}

export async function handleProposalApprovedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await BridgeInboundingRecord.get(id)
    if (record !== undefined) {
        record.status = 'Approved'
        await record.save()
        logger.debug(`Inbounding record approved: ${id}`)
    }
}

export async function handleProposalSucceededEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await BridgeInboundingRecord.get(id)
    if (record !== undefined) {
        record.status = 'Succeeded'

        let txId = ctx.extrinsic?.extrinsic.hash.toHex()
        let executeTx = new Tx(txId)
        executeTx.hash = ctx.extrinsic?.extrinsic.hash.toHex()
        executeTx.sender = ctx.extrinsic?.extrinsic.signer.toString()
        await executeTx.save()

        record.executeTx = txId
        await record.save()
        logger.debug(`Inbounding record succeeded: ${id}, with execute tx: ${executeTx}`)
    }
}

export async function handleProposalRejectedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await BridgeInboundingRecord.get(id)
    if (record !== undefined) {
        record.status = 'Rejected'
        await record.save()
        logger.debug(`Inbounding record rejected: ${id}`)
    }
}

export async function handleProposalFailedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await BridgeInboundingRecord.get(id)
    if (record !== undefined) {
        record.status = 'Failed'
        await record.save()
        logger.debug(`Inbounding record failed: ${id}`)
    }
}

export async function handleXcmTransferedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [asset, origin, dest],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation, XcmV1MultiLocation]>

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let sender = origin.interior.asX1.asAccountId32.id.toString()
    let recipient
    if (dest.parents.eq(1) && dest.interior.isX1 && dest.interior.asX1.isAccountId32) { // to relaychain
        recipient = encodeAddress(dest.interior.asX1.asAccountId32.id.toHex(), 42).toString()
    } else if (dest.parents.eq(1) && dest.interior.isX2 && dest.interior.asX2[0].isParachain && dest.interior.asX2[1].isAccountId32) {  // to parachain
        recipient = encodeAddress(dest.interior.asX2[1].asAccountId32.id.toHex(), 42).toString()
    } else {
        recipient = 'unknown'
    }

    const id = `${sender}-${hash}`
    let record = await XcmTransfered.get(id)
    if (record === undefined) {
        const record = new XcmTransfered(id)
        record.createdAt = ctx.block.timestamp
        record.sender = sender
        record.asset = asset.id.asConcrete.toString()
        record.recipient = recipient
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = asset.fun.asFungible.toBigInt()
        await record.save()
        logger.debug(`Add new XcmTransfered record: ${record}`)
    }
}

export async function handleXcmDepositedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [what, who],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation]>

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let recipient
    let isForward = false
    if (who.parents.eq(0)) {
        if (who.interior.isX1 && who.interior.asX1.isAccountId32) { // local account
            recipient = encodeAddress(who.interior.asX1.asAccountId32.id.toHex(), 42).toString()
        } else if (who.interior.isX3 && who.interior.asX3[2].isGeneralKey) {    // EVM account
            recipient = who.interior.asX3[2].asGeneralKey.toHex()
            isForward = true
        }
    } else {
        recipient = 'unknown'
    }

    const id = `${recipient}-${hash}`
    let record = await XcmDeposited.get(id)
    if (record === undefined) {
        const record = new XcmDeposited(id)
        record.createdAt = ctx.block.timestamp
        record.asset = what.id.asConcrete.toString()
        record.recipient = recipient
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = what.fun.asFungible.toBigInt()
        record.isForward = isForward
        await record.save()
        logger.debug(`Add new XcmDeposited record: ${record}`)
    }
}

export async function handleXcmWithdrawnEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [what, who],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation]>

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let depositer
    let isForward = false
    if (who.parents.eq(0) && who.interior.isX1 && who.interior.asX1.isAccountId32) {
        depositer = encodeAddress(who.interior.asX1.asAccountId32.id.toHex(), 42).toString()
    } else {
        depositer = 'unknown'
    }

    const id = `${depositer}-${hash}`
    let record = await XcmWithdrawn.get(id)
    if (record === undefined) {
        const record = new XcmWithdrawn(id)
        record.createdAt = ctx.block.timestamp
        record.asset = what.id.asConcrete.toString()
        record.depositer = depositer
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = what.fun.asFungible.toBigInt()
        await record.save()
        logger.debug(`Add new XcmWithdrawn record: ${record}`)
    }
}