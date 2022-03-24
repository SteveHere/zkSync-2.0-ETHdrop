export type PseudoMap<T> = Record<string, T>;

export type TupleUnion<U extends string, R extends string[] = []> = {
    [S in U]: Exclude<U, S> extends never ? [...R, S] : TupleUnion<Exclude<U, S>, [...R, S]>;
}[U] & string[]

// The states that can be sent to the server
export enum ClientEvent {
    GET_NONCE           = 100,      // Response: string
    // For the requesters
    R_BC_REQUEST        = 200,      // Response: requester - 'T', receivers - string
    // For the senders
    S_OPEN_RECEIVER     = 300,      // Response: Receiver status, 'Open' or 'Closed'
    S_CLOSE_RECEIVER    = 310,      // Response: Receiver status, 'Open' or 'Closed'
}

// The states that can be sent to the client
export enum ServerEvent {
    SEND_NONCE  = 10,
    CONNECTED   = 20,
    A_CHANGED   = 30,

    S_R_REQUEST = 100,
    
    S_RESPONSE  = 110,

    ERROR       = 500,
    DISCONNECT  = 510,
}

// Messages that can be sent by the client

export type ClientPayload = {
    event: ClientEvent
}
const ClientPayloadKeys: TupleUnion<keyof ClientPayload> = ["event"];

export type SIWEPayload = {
    message: string,
    signature: string,
}
const SIWEPayloadKeys: TupleUnion<keyof SIWEPayload> = ["message", "signature"];

// Messages that can be sent by the server

export type WSResponse = {
    event: ServerEvent,
    response: string,
}
const WSResponseKeys: TupleUnion<keyof WSResponse> = ["event", "response"];

// Heartbeat: Can be sent by both

export type Heartbeat = {
    pulse: "HB",
}
const HeartbeatKeys: TupleUnion<keyof Heartbeat> = ["pulse"];

export enum ClientPayloadType {
    NOT_A_PAYLOAD   = -1,
    HB              = 1,
    SIWE            = 2,
    CLIENT          = 3,
}

export enum ServerPayloadType {
    NOT_A_PAYLOAD   = -1,
    HB              = 1,
    RESPONSE        = 2,
}

const payloadOnlyHasFilledFields = (payload: any, keys: string[]) => {
    if(payload === undefined || payload === null || typeof payload !== "object") return false;
    const payloadKeys = Object.keys(payload);
    if(payloadKeys.length !== keys.length) return false;
    if(payloadKeys.some(p=>keys.indexOf(p) === -1)) return false;
    for (var i = 0; i < keys.length; i++) { 
        if(payload[keys[i]] === undefined || payload[keys[i]] === null) return false;
    }
    return true;
};

export const guessServerPayloadType = (payload: any): ServerPayloadType => {
    if(!payload || typeof payload !== "object") return ServerPayloadType.NOT_A_PAYLOAD;
    if(payloadOnlyHasFilledFields(payload, HeartbeatKeys)) return ServerPayloadType.HB;
    if(payloadOnlyHasFilledFields(payload, WSResponseKeys)) return ServerPayloadType.RESPONSE;
    return ServerPayloadType.NOT_A_PAYLOAD;
};

export const guessClientPayloadType = (payload: any): ClientPayloadType => {
    if(!payload || typeof payload !== "object") return ClientPayloadType.NOT_A_PAYLOAD;
    if(payloadOnlyHasFilledFields(payload, HeartbeatKeys)) return ClientPayloadType.HB;
    if(payloadOnlyHasFilledFields(payload, SIWEPayloadKeys)) return ClientPayloadType.SIWE;
    if(payloadOnlyHasFilledFields(payload, ClientPayloadKeys)) return ClientPayloadType.CLIENT;
    return ClientPayloadType.NOT_A_PAYLOAD;
};

export const SIWEPayloadIsValid = (payload: any): payload is SIWEPayload => {
    return (
        payload &&
        typeof payload === "object" &&

        payload['message'] &&
        typeof payload['message'] === "string" && 

        payload['signature'] &&
        typeof payload['signature'] === "string"
    );
};

export const clientPayloadIsValid = (payload: any): payload is ClientPayload => {
    return (
        payload &&
        typeof payload === "object" &&

        payload['event'] &&
        typeof payload['event'] === "number" && 
        (<any>Object).values(ClientEvent).includes(payload["event"])
    );
}

export const WSResponseIsValid = (payload: any): payload is WSResponse => {
    return(
        payload &&
        typeof payload === "object" &&

        payload['event'] &&
        typeof payload['event'] === "number" && 
        (<any>Object).values(ServerEvent).includes(payload["event"]) &&

        payload['response'] && 
        typeof payload['response'] === "string" && 
        payload['response'].length > 0
    )
}


export const SIWEMessageDetails = {
    chainId: 280, // ZKSync 2.0 L2 Goerli Testnet
    statement: "ETH Airdrop App for ZkSync 2.0 Testnet",
    cutOffInMinutes: 5,
}

export const eth_address_regex = /^0x[a-fA-F0-9]{40}$/;
export const HEARTBEAT_FRAME = JSON.stringify({ pulse: "HB" });
export const WS_PORT = 44021;