import { totalmem, freemem } from 'os';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, ServerResponse } from 'http';
import { readFile, readFileSync, stat, createReadStream } from 'fs';
import { ErrorTypes, generateNonce, SiweMessage } from 'siwe';
import { v4 as uuidV4 } from 'uuid';
import { join as path_join } from 'path';
import { createGzip } from 'zlib';

import { 
    ServerEvent, ClientEvent, SIWEMessageDetails, 
    ClientPayloadType, guessClientPayloadType, 
    HEARTBEAT_FRAME, WS_PORT, SIWEPayloadIsValid, clientPayloadIsValid,
} from "./common";

type wsData = {
    address: string,
    lastNonce: string,
    active: boolean,
    sender: boolean,
    lastRequest: number,
    socket: WebSocket,
}

const WSReply = (e: ServerEvent, r: string): string => JSON.stringify({ event: e, response: r });

// Mapping: (uuid) => wsData
const sessions: Record<string , wsData> = {};
// Mapping: (address) => uuid
const addressUUIDMap: Record<string, string> = {}

const broadcastToSenders = (source: string, payload: string): number => {
    let counter = 0;
    Object.values(sessions).filter(data=>data.sender && data.active && source !== data.address).forEach(data=>{ data.socket.send(payload); counter++ });
    return counter;
}

const getCutOff = (minutes: number) => Date.now() - (1000 * 60 * minutes);

const validateFields = (fields: SiweMessage, nonce: string) => {
    if(!fields) throw "Invalid signature"
    if(fields.version !== "1") throw "Wrong SIWE version";
    if(fields.nonce !== nonce) throw "Wrong nonce";
    if(fields.chainId !== SIWEMessageDetails.chainId) throw "Wrong network";
    if((new Date(fields.issuedAt)).getTime() < getCutOff(SIWEMessageDetails.cutOffInMinutes)) 
        throw `Message was signed late: Must be signed within ${SIWEMessageDetails.cutOffInMinutes} minutes`;
    if(!fields.expirationTime) throw "Expiration time field not found";
    if((new Date(fields.expirationTime)).getTime() < Date.now()) throw "Signature Expired";
    if(!fields.statement || !fields.statement.includes(SIWEMessageDetails.statement)) throw "Wrong statement";
}

let wss = new WebSocketServer({ clientTracking: true, noServer: true });

wss.on("connection", (socket)=>{
    let wsNonce: string | null = null;
    let performedFirstLogin = false;
    const s_uuid = uuidV4();
    socket.on("message", async (data)=>{
        let payload = JSON.parse(data.toString("utf-8"));
        const signedIn = s_uuid in sessions;
        const payloadType = guessClientPayloadType(payload);
        try {
            if(payloadType === ClientPayloadType.HB) {
                if(signedIn) sessions[s_uuid].active = true;
            } else if (payloadType === ClientPayloadType.NOT_A_PAYLOAD) {
                socket.send(WSReply(ServerEvent.ERROR, "Undetectable payload format"));
            } else if (payloadType === ClientPayloadType.SIWE) {
                if(wsNonce === null) throw "No nonce initialized";
                try{
                    if(!SIWEPayloadIsValid(payload)) throw "Wrong sign-in payload format";
                    const fields = await (new SiweMessage(payload.message)).validate(payload.signature);
                    validateFields(fields, wsNonce);
                    if(signedIn){
                        if(sessions[s_uuid].lastNonce === wsNonce) throw "Nonce has been reused";
                        // Remove old address->UUID mapping
                        delete addressUUIDMap[sessions[s_uuid].address];
                        // Create new mapping
                        addressUUIDMap[fields.address] = s_uuid;
                        // Rename address
                        sessions[s_uuid].address = fields.address;
                        sessions[s_uuid].lastNonce = wsNonce;
                        sessions[s_uuid].active = true;
                        socket.send(WSReply(ServerEvent.A_CHANGED, fields.address));
                    } else {
                        sessions[s_uuid] = { 
                            address: fields.address, lastNonce: wsNonce, active: true, sender: false, 
                            lastRequest: 0, socket: socket, 
                        };
                        addressUUIDMap[fields.address] = s_uuid;
                        socket.send(WSReply(ServerEvent.CONNECTED, fields.address));
                        performedFirstLogin = true;
                    }
                } catch (error: any) {
                    // Encountered verification error: Should never occur if client is truthful
                    // Hard abort & disconnect
                    delete addressUUIDMap[sessions[s_uuid].address];
                    delete sessions[s_uuid];
                    let errorCode = 500;
                    if(typeof error === "string"){
                        socket.close(errorCode, WSReply(ServerEvent.ERROR, `SIWE Error - ${error}. Disconnecting.`));
                    } else {
                        switch (error) {
                            case ErrorTypes.EXPIRED_MESSAGE: { errorCode = 440; break; }
                            case ErrorTypes.INVALID_SIGNATURE: { errorCode = 422; break; }
                            default: { errorCode = 500; break; }
                        }
                        socket.close(errorCode, WSReply(ServerEvent.ERROR, `SIWE Error - ${error.message}. Disconnecting.`));
                    }
                    return;
                }
            } else if (payloadType === ClientPayloadType.CLIENT) {
                if(!clientPayloadIsValid(payload)) throw "Wrong client payload format";
                if(payload.event === ClientEvent.GET_NONCE){
                    wsNonce = generateNonce();
                    socket.send(WSReply(ServerEvent.SEND_NONCE, wsNonce));
                    return;
                }
                if(!signedIn) throw "Not Signed in";
                if(payload.event === ClientEvent.R_BC_REQUEST) {
                    if(sessions[s_uuid].lastRequest > getCutOff(5)) throw "Broadcasts are rate-limited to 1 per 5 mins"
                    let result = broadcastToSenders(sessions[s_uuid].address, WSReply(ServerEvent.S_R_REQUEST, sessions[s_uuid].address));
                    socket.send(WSReply(ServerEvent.S_RESPONSE, result.toString()));
                    sessions[s_uuid].lastRequest = Date.now();
                } else if (payload.event === ClientEvent.S_OPEN_RECEIVER || payload.event === ClientEvent.S_CLOSE_RECEIVER) {
                    sessions[s_uuid].sender = (payload.event === ClientEvent.S_OPEN_RECEIVER); 
                    socket.send(WSReply(ServerEvent.S_RESPONSE, sessions[s_uuid].sender ? "Open" : "Closed"));
                }
                sessions[s_uuid].active = true;
            }
        } catch ( error: any ) {
            console.log("Error: " + error);
            if(error.message !== undefined && error.message !== null){
                socket.send(WSReply(ServerEvent.ERROR, `NFOC: ${error.message}`)); // NFOC: Not from own code
            } else {
                socket.send(WSReply(ServerEvent.ERROR, `${error}`));
            }
        }
    });
    setTimeout(()=>{
        if(!performedFirstLogin){
            socket.close(408, WSReply(ServerEvent.ERROR, `Client Error - Waited too long to sign in.`));
        }
    }, 1000 * 60 * 7);
});

console.log("WS Server starting up");

const return404 = (r: ServerResponse) => { r.writeHead(404, {"Content-Type": "text/plain"}); r.write("404 Not Found\n"); r.end(); }

const fileCache: Record<string, any> = {};

const server = createServer();

server.on("request", (request, response) => {
    var uri = new URL(request.url!, `http://${request.headers.host}`).pathname, filename = path_join(process.cwd(), uri);

    if (request.url === "/heartbeat") { console.log(`Connections: ${Object.keys(sessions)}`); }

    if (uri === '/websocket') {
        response.writeHead(200); response.end(); return;
    }

    if (request.url?.includes("common.js") || request.url?.includes("server.js")) {
        return404(response); return;
    }

    stat(filename, function(err, stats) {
        if(err) {
            return404(response); return;
        }

        if (stats.isDirectory()) filename += '/index.html';

        try {
            let acceptEncoding = request.headers['accept-encoding'];
            if (!acceptEncoding) { acceptEncoding = ''; }
            if (typeof acceptEncoding === "object") { acceptEncoding = acceptEncoding[0] };

            let contentType = "text/html; charset=utf-8";
            switch(filename.split(".").pop()){
                case "html":    contentType = "text/html; charset=utf-8";                   break;
                case "js":      contentType = "application/javascript; charset=utf-8";      break;
                case "css":     contentType = "text/css; charset=utf-8";                    break;
                case "svg":     contentType = "image/svg+xml; charset=utf-8";               break;
            }

            let headers: Record<string, string> = {
                "Content-Type": contentType,
            }
            if (acceptEncoding.match(/\bgzip\b/)) {
                stat(filename + ".gz", function(err, stats) {
                    let raw = null;
                    if(err){
                        raw = createReadStream(filename);
                    } else {
                        headers['Content-Encoding'] = "gzip";
                        raw = createReadStream(filename + ".gz");
                    }
                    response.writeHead(200, headers);
                    raw.pipe(response, {end: true});
                });
            } else {
                response.writeHead(200, headers);
                let raw = createReadStream(filename);
                raw.pipe(response, {end: true});
            }
        } catch ( error ) {
            response.writeHead(500, {"Content-Type": "text/plain"});
            response.write(err + "\n"); 
            response.end();
        }
    });
});

server.on('upgrade', function upgrade(request, socket, head) {
    var uri = new URL(request.url!, `http://${request.headers.host}`).pathname;
  
    if (uri === '/websocket') {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
});

server.listen(process.env.PORT || 80);

console.log("Web server startng up");

const memoryCheckup = setInterval(()=>{
    console.log(((a,b)=>`${(b-a)/b} (${(b-a)}/${b})`)(freemem(), totalmem()));
}, 1000 * 60 * 10);

const wsCMCleanup = setInterval(()=>{
    Object.keys(sessions).forEach(uuid=>{
        // Clean up connections that did not respond to the heartbeat for the past 30 seconds
        if(!sessions[uuid].active){
            sessions[uuid].socket.close(408, WSReply(ServerEvent.DISCONNECT, "Heartbeat missing - Disconnecting."));
            delete addressUUIDMap[sessions[uuid].address];
            delete sessions[uuid];
        } else {
            sessions[uuid].active = false;
            sessions[uuid].socket.send(HEARTBEAT_FRAME);
        }
    });
}, 1000 * 30);

process.on("SIGTERM", _signal=>{
    console.log("shutting down");
    wss.close(()=> console.log('websocket server has closed'));
    server.close(() => console.log('server has closed'));
    clearInterval(memoryCheckup);
    clearInterval(wsCMCleanup);
});