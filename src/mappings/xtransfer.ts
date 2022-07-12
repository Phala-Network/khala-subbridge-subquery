import { Bytes, U256 } from '@polkadot/types'
import { IEvent } from '@polkadot/types/types'
import { SubstrateEvent } from '@subql/types'
import { AccountId } from "@polkadot/types/interfaces"
import { XcmV1MultiAsset, XcmV1MultiLocation } from '@polkadot/types/lookup'

import { BridgeChainId, DepositNonce, ResourceId } from '../interfaces'
import {
    Tx, XTransferWithdrawn, XTransferDeposited, XTransferForwarded, XTransferSent,
    SendingCount, RecevingCount, XcmTransfered, CTxSent, CTxReceived,
} from '../types'

export async function handleXTransferWithdrawn(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [asset, location],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation]>

    let payer: string
    if (location.parents.eq(0) && location.interior.isX1 && location.interior.asX1.isAccountId32) {
        // Indicated by pubkey
        payer = location.interior.asX1.asAccountId32.id.toHex()
    } else {
        payer = 'unknown'
    }

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let id = `${payer}-${hash}`
    let record = await XTransferWithdrawn.get(id)
    if (record === undefined) {
        record = new XTransferWithdrawn(id)
        record.createdAt = ctx.block.timestamp
        record.account = payer
        record.asset = asset.id.asConcrete.toHex()
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = asset.fun.asFungible.toBigInt()
        await record.save()
        logger.debug(`Add new XTransferWithdrawn record: ${record}`)
    }
}

export async function handleXTransferDeposited(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [asset, location],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation]>

    let recipient: string
    let isLocal: boolean = false
    let isRemote: boolean = false
    if (location.parents.eq(1) && location.interior.isX1 && location.interior.asX1.isAccountId32) {
        recipient = location.interior.asX1.asAccountId32.id.toHex()
        isLocal = true
    } else {
        recipient = location.toHex()
        isRemote = true
    }

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let id = `${recipient}-${hash}`
    let record = await XTransferDeposited.get(id)
    if (record === undefined) {
        record = new XTransferDeposited(id)
        record.createdAt = ctx.block.timestamp
        if (isLocal == true) {
            record.isLocal = true
            record.account = recipient
        } else {
            record.isRemote = true
            record.location = recipient
        }
        record.asset = asset.id.asConcrete.toString()
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = asset.fun.asFungible.toBigInt()

        // Set index
        let recevingCount = await RecevingCount.get(recipient)
        if (recevingCount == undefined) {
            recevingCount = new RecevingCount(recipient)
            recevingCount.count = 1
            record.index = 0
        } else {
            record.index = recevingCount.count
            recevingCount.count = recevingCount.count + 1
        }

        await recevingCount.save()
        await record.save()
        logger.debug(`Add new XTransferDeposited record: ${record}`)
    }
}

export async function handleXTransferForwarded(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [asset, location],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation]>

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let id = `bridge-${hash}`
    let record = await XTransferForwarded.get(id)
    if (record === undefined) {
        record = new XTransferForwarded(id)
        record.createdAt = ctx.block.timestamp
        record.location = location.toHex()
        record.asset = asset.id.asConcrete.toHex()
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = asset.fun.asFungible.toBigInt()
        await record.save()
        logger.debug(`Add new XTransferForwarded record: ${record}`)
    }
}

export async function handleXcmbridgeTransferedEvent(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [asset, origin, dest],
    } = ctx.event as unknown as IEvent<[XcmV1MultiAsset, XcmV1MultiLocation, XcmV1MultiLocation]>

    let hash = ctx.extrinsic?.extrinsic.hash.toHex()
    let sender = origin.interior.asX1.asAccountId32.id.toString()
    let recipient
    if (dest.parents.eq(1) && dest.interior.isX1 && dest.interior.asX1.isAccountId32) { // to relaychain
        recipient = dest.interior.asX1.asAccountId32.id.toHex()
    } else if (dest.parents.eq(1) && dest.interior.isX2 && dest.interior.asX2[0].isParachain && dest.interior.asX2[1].isAccountId32) {  // to parachain
        recipient = dest.interior.asX2[1].asAccountId32.id.toHex()
    } else {
        recipient = 'unknown'
    }

    const id = `${sender}-${hash}`
    let record = await XcmTransfered.get(id)
    if (record === undefined) {
        record = new XcmTransfered(id)
        record.createdAt = ctx.block.timestamp
        record.sender = sender
        record.asset = asset.id.asConcrete.toString()
        record.recipient = recipient
        // We can safely unwrap here because currently only support fungible transfer
        record.amount = asset.fun.asFungible.toBigInt()
        await record.save()
        logger.debug(`Add new XcmTransfered record: ${record}`)

        // Create corresponding XTransferSent record
        const xTransferSent = new XTransferSent(`xtransfer-${sender}-${hash}`)
        xTransferSent.createdAt = ctx.block.timestamp
        xTransferSent.isXcm = true
        xTransferSent.xcm = id
        xTransferSent.sender = sender
        // Set index
        let sendingCount = await SendingCount.get(sender)
        if (sendingCount == undefined) {
            sendingCount = new SendingCount(sender)
            sendingCount.count = 1
            xTransferSent.index = 0
        } else {
            xTransferSent.index = sendingCount.count
            sendingCount.count = sendingCount.count + 1
        }

        await sendingCount.save()
        await xTransferSent.save()
        logger.debug(`Add new xTransferSent record: ${xTransferSent}`)
    }
}

export async function handleChainbridgeFungibleTransfer(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec, resourceId, amount, recipient],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce, ResourceId, U256, Bytes]>

    const chainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${chainId}-${depositNonce}`

    if (undefined === (await CTxSent.get(id))) {
        const record = new CTxSent(id)
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

        // Create corresponding XTransferSent record
        let hash = ctx.extrinsic?.extrinsic.hash.toHex()
        const xTransferSent = new XTransferSent(`xtransfer-${record.sender}-${hash}`)
        xTransferSent.createdAt = ctx.block.timestamp
        xTransferSent.isChainbridge = true
        xTransferSent.chainbridge = id
        xTransferSent.sender = record.sender
        // Set index
        let sendingCount = await SendingCount.get(record.sender)
        if (sendingCount == undefined) {
            sendingCount = new SendingCount(record.sender)
            sendingCount.count = 1
            xTransferSent.index = 0
        } else {
            xTransferSent.index = sendingCount.count
            sendingCount.count = sendingCount.count + 1
        }

        await sendingCount.save()
        await xTransferSent.save()
        logger.debug(`Add new xTransferSent record: ${xTransferSent}`)
    }
}

export async function handleChainbridgeProposalVoteFor(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec, _voter],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce, AccountId]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await CTxReceived.get(id)
    if (record === undefined) {
        record = new CTxReceived(id)
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

export async function handleChainbridgeProposalApproved(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await CTxReceived.get(id)
    if (record !== undefined) {
        record.status = 'Approved'
        await record.save()
        logger.debug(`Inbounding record approved: ${id}`)
    }
}

export async function handleChainbridgeProposalSucceeded(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await CTxReceived.get(id)
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

export async function handleChainbridgeProposalRejected(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await CTxReceived.get(id)
    if (record !== undefined) {
        record.status = 'Rejected'
        await record.save()
        logger.debug(`Inbounding record rejected: ${id}`)
    }
}

export async function handleChainbridgeProposalFailed(ctx: SubstrateEvent): Promise<void> {
    const {
        data: [chainIdCodec, depositNonceCodec],
    } = ctx.event as unknown as IEvent<[BridgeChainId, DepositNonce]>

    const originChainId = chainIdCodec.toNumber()
    const depositNonce = depositNonceCodec.toBigInt()

    const id = `${originChainId}-${depositNonce}`
    let record = await CTxReceived.get(id)
    if (record !== undefined) {
        record.status = 'Failed'
        await record.save()
        logger.debug(`Inbounding record failed: ${id}`)
    }
}
