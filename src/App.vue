<script setup lang="ts">
import type { PseudoMap, ClientPayload, SIWEPayload } from "./common";

enum TxStatus {
  IDLE,
  SUBMITTING_APPROVAL,
  AWAITING_APPROVAL_COMMIT,
  SUBMITTING_TRANSFER,
  AWAITING_TRANSFER_COMMIT,
  DONE,
}

type EthRequestData = {
  lock: boolean,
  balance: BigNumber | null
};

type Message = {
  id: number,
  content: string,
};

type EthRequestsMap = PseudoMap<EthRequestData>;

type LockMapProperties = "websocket"|"fee"|"balance"|"approval";
type LockMap = {
  [key in LockMapProperties]: boolean;
}&{
  websocket: boolean;
  fee: boolean;
  balance: boolean;
  approval: boolean;
};


type DataReturn = {
  shown: string,

  web3provider: Web3Provider | null,
  signer: Signer | null,
  ETHToken: { address: string, decimals: number, symbol: string, contract: Contract | null, },
  ETHDistributor: { address: string, abi: PseudoMap<any>[], contract: Contract | null, minETH: any, HOST: string, },

  ws: WebSocket | null,
  
  successes: Message[],
  warnings: Message[],
  errors: Message[],

  ethRequests: EthRequestsMap,
  selectedRequests: string[],
  txStatus: TxStatus,

  locks: LockMap,
  current: { 
    count: number, address: string | null, nonce: string | null, 
    balance: BigNumber | null, fee: string, approvedAmount: string, receiverOpen: boolean, 
  },

  txFeeIsCalculable: boolean,
  onlyLowBalances: boolean,
  amountPerRecipient: string,
};

</script>

<template>
	<div class="app middle-align-text">
    <div class="header">
      <h1> zkSync 2.0 ETH Airdrop </h1>
      <div>
        <b><span class="error">WARNING:</span> THIS DAPP IS EXPERIMENTAL. <span class="error">USE AT YOUR OWN RISK!</span></b>
      </div>
    </div>
		
		<div class="main-box">
			<div class="top-spacing">
        <p>Address: <span v-if="!current.address">Loading...</span> <span class="address" v-else>{{current.address}}</span></p>
				<p>Balance: <span v-if="locks.balance || !current.balance">Loading...</span> <span v-else>{{ethersUtils.formatEther(truncatedBalance)}} {{ETHToken.symbol}}</span>
				<button class="left-spacing" v-on:click="updateBalance">Refresh</button>
				</p>
			</div>

      <a class="navbar-link middle-align-text flexify flex-center flex-end" v-on:click="toggleShown('#request-eth')">
        Request Testnet ETH &nbsp;<span v-if="shown === '#request-eth'">🔼</span><span v-else>🔽</span>
      </a>
      
			<div id="request-eth" v-show="shown === '#request-eth'" class="request-portion flexify" >
				<button :disabled="!current.address || locks.websocket" v-on:click="broadcastRequest">Broadcast Request</button>
			</div>

      
      <a class="navbar-link middle-align-text flexify flex-center flex-end top-spacing" v-on:click="toggleShown('#send-eth')">
        Send Testnet ETH &nbsp;<span v-if="shown === '#send-eth'">🔼</span><span v-else>🔽</span>
      </a>
      
			<div id="send-eth"  v-show="shown === '#send-eth'" class="sender-portion flexify">
        <div class="flexify flex-column tx-section" v-if="txFeeIsCalculable">
          <span class="middle-align-text">
            Expected transfer fee: <span v-if="locks.fee">Loading...</span> <span class="nowrap" v-else>{{current.fee}} {{ETHToken.symbol}}</span>
          </span>
          <button class="left-spacing" v-on:click="updateFee">Refresh</button>
        </div>
        <div class="flexify flex-column tx-section" v-else>
          <span v-if="locks.fee">Loading...</span>
          <span v-if="!locks.fee" class="warning">Couldn't estimate TX fees: More approved ETH is required.</span>
          <span v-if="!locks.fee" >(Estimated transfer fee based on tests: 0.000000000600012 ETH)</span>
          <button class="left-spacing" v-on:click="updateFee">Refresh</button>
        </div>
        
        <hr>
        <div class="flexify flex-column">
          <span>
            Approved amount: <span v-if="locks.approval">Loading...</span> <span v-else>{{current.approvedAmount}} {{ETHToken.symbol}}</span>
          </span>
          <button class="left-spacing" v-on:click="updateApprovedAmount">Refresh</button>
          <button class="left-spacing" v-on:click="approveOneMoreETH">Approve 1 more ETH</button>
        </div>

        <hr>
        <div class="flexify flex-column">
          <button v-if="current.receiverOpen" :disabled="ws === null || locks.websocket" class="left-spacing" v-on:click="toggleReceiver(ClientEvent.S_CLOSE_RECEIVER)">
            Stop receiving requests
          </button>
          <button v-else :disabled="ws === null || locks.websocket" class="left-spacing" v-on:click="toggleReceiver(ClientEvent.S_OPEN_RECEIVER)">
            Start receiving requests
          </button>
        </div>

        <hr>
        <div class="flexify flex-column flex-center">
          <label class="warning warning-border middle-align-text warning-bg-color" v-if="parsedAmountPerRecipient.lt(ETHDistributor.minETH)">
            ETH amount too low
          </label>
          <div class="middle-align-text">
            ETH to distribute: 
            <span class="nowrap">
              <input id="amountPerRecipient" type="number" :value="amountPerRecipient" min="0.0001" :disabled="txStatus !== TxStatus.IDLE" v-on:input="updateAPR($event)"> <b>{{ETHToken.symbol}}</b> / address
            </span>
          </div>
          <label for="onlyLowBalances" class="middle-align-text">
            <input id="onlyLowBalances" type="checkbox" v-model="onlyLowBalances" v-on:change="updateOLB($event)" /> Only show &amp; receive addresses with &lt; {{amountPerRecipient}} <b>{{ETHToken.symbol}}</b>
          </label>
          <button class="top-spacing" v-on:click="getBalanceOfRequesters">Refresh all balances of visible requests </button>
          <button class="top-spacing" v-on:click="selectAllVisibleRequests">Select all visible requests</button>
          <button class="top-spacing" :disabled="!(selectedRequests.length > 0 && txStatus == TxStatus.IDLE && !locks.fee)" v-on:click="sendTestnetETHSync">
            <span v-if="txStatus === TxStatus.IDLE">
              Send {{amountPerRecipient}} {{ETHToken.symbol}} (Removes selected on success)
            </span>
            <span v-else-if="txStatus === TxStatus.SUBMITTING_APPROVAL">Submitting approval request...</span>
            <span v-else-if="txStatus === TxStatus.AWAITING_APPROVAL_COMMIT">Waiting for approval to be committed...</span>
            <span v-else-if="txStatus === TxStatus.SUBMITTING_TRANSFER">Sending tx to distribute ETH...</span>
            <span v-else-if="txStatus === TxStatus.AWAITING_TRANSFER_COMMIT">Waiting until tx is committed...</span>
          </button>
        </div>

        <br />
        <table id="requests-table" v-if="Object.keys(ethRequests).length > 0">
          <tbody>
            <template v-for="[address, data] in getVisibleRequests" :key="address" >
              <tr>
                <td><input :id="address" :value="address" type="checkbox" class="address-checkbox" :checked="selectedRequests.includes(address)" v-on:change="addAddressToSR($event, address)" /></td>
                <td>
                  <label :for="address">
                    <div><a target="_blank" :href="'https://zksync2-testnet.zkscan.io/address/' + address" >{{address}}</a></div>
                    <div>
                      <span v-if="data.lock">Loading ...</span>
                      <span v-else-if="data.balance">{{ethersUtils.formatEther(data.balance)}} <b>{{ETHToken.symbol}}</b></span>
                      <span v-else>(Balance not retrieved yet)</span>
                    </div>
                  </label>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <button v-on:click="backToTop" class="top-spacing">Scroll back to top ↑</button>
			</div>
		</div>
	</div>
  <div v-show="successes.length > 0 || warnings.length > 0 || errors.length > 0" class="msg-overlay flexify flex-column flex-center align-center">
    <div class="top-spacing success success-border flexify flex-column" v-if="successes.length > 0">
      <message-holder v-for="message in successes" :key="message.id" :message="message.content" @expired="expireSuccessMessage(message)" class="success flexify">
      </message-holder>
    </div>

    <div class="top-spacing warning warning-border flexify flex-column" v-if="warnings.length > 0">
      <message-holder v-for="message in warnings" :key="message.id" :message="message.content" @expired="expireWarningMessage(message)" class="warning flexify">
      </message-holder>
    </div>

    <div class="top-spacing error error-message error-border flexify flex-column" v-if="errors.length > 0">
      <message-holder v-for="message in errors" :key="message.id" :message="message.content" @expired="expireErrorMessage(message)" class="error-message flexify">
      </message-holder>
    </div>
  </div>

	<div v-show="signer === null" class="connect-overlay">
	</div>
  <div v-show="signer === null" class="start-screen flexify flex-column flex-center middle-align-text">
    <h1>Connect to your wallet</h1>
    <button v-on:click="connectMetamask">Connect Metamask</button>
  </div>
</template>

<script lang="ts">
import { types, utils as zkUtils, Web3Provider, Contract, Signer } from "zksync-web3";
import { utils as ethersUtils, BigNumber } from "ethers";
import type { TransactionReceipt } from "@ethersproject/providers";
import { markRaw } from "vue";

import { SiweMessage } from 'siwe';

import { 
  ServerEvent, ClientEvent, SIWEMessageDetails, 
  ServerPayloadType, guessServerPayloadType, 
  eth_address_regex, HEARTBEAT_FRAME, WSResponseIsValid,
} from "./common";

import MessageHolder from './components/Message.vue';

const until = (conditionFunction: (()=>boolean)) => {
  const poll = (resolve: CallableFunction) => {
    if(conditionFunction()) resolve();
    else setTimeout(_ => poll(resolve), 400);
  }
  return new Promise(poll);
}

export default {
	name: 'App',
  components: {
    'message-holder': MessageHolder
  },
	data(): DataReturn {
		return {
      shown: "",

      web3provider: null,
			signer: null,
			ETHToken: { address: zkUtils.ETH_ADDRESS, decimals: 18, symbol: "ETH", contract: null, },
      ETHDistributor: {
        address: "0xCB5Da48c9151A59Ae29eb238fcecaa4ad3c9699A",
        abi: [
          {
            "inputs": [
              { "indexed": false, "internalType": "uint256", "name": "totalSent", "type": "uint256" },
              { "indexed": false, "internalType": "uint256", "name": "totalRecipients", "type": "uint256" }
            ],
            "name": "DistributionComplete", "type": "event", "anonymous": false,
          },
          { "inputs": [ 
              { "internalType": "address[]", "name": "_recipients", "type": "address[]" },
              { "internalType": "uint256", "name": "amountPerRecipient", "type": "uint256" }
            ],
            "name": "distributeETH", "type": "function", "outputs": [], "stateMutability": "payable",
          }
        ],
        minETH: ethersUtils.parseEther("0.0001"),
        HOST: document.location.host,
        contract: null,
      },

      ws: null,
      
      successes: [],
      warnings: [],
      errors: [],

      ethRequests: {},
      selectedRequests: [],
			txStatus: TxStatus.IDLE,

      locks: { websocket: false, fee: false, balance: false, approval: false, },
      current: { count: 0, address: null, nonce: null, balance: null, fee: "", approvedAmount: "", receiverOpen: false, },

      txFeeIsCalculable: true,
      onlyLowBalances: true,
      amountPerRecipient: '0.005',
		}
	},
  mounted(){
    if(this.correctNetwork){
      console.log("On correct network: Connecting to Metamask");
      this.connectMetamask();
      (window as any).ethereum.on('accountsChanged', (accounts: Array<string>)=>{
        // only do this if the following have been initialized
        if(this.web3provider || this.signer || this.ETHToken.contract || this.ETHDistributor.contract){
          this.warnings.push(this.createMessage("Account has changed - Re-logging in via SIWE."));
          this.connectMetamask();
        } else {
          console.log("event fired but nulls exist: probably 1st signin on this session");
        }
      });
      (window as any).ethereum.on('chainChanged', (_chainId: any) => {
        if(!this.correctNetwork){
          this.warnings.push(this.createMessage("Network has changed - Refreshing in 5 seconds.")); 
          setTimeout(()=>{window.location.reload()}, 5000);
        }
      });
    }

    this.shown = window.location.hash;
  },
  computed: {
    correctNetwork(): boolean{
      if((window as any).ethereum === undefined) return false;
      return (window as any).ethereum.networkVersion == 280;
    },
    parsedAmountPerRecipient(): BigNumber {
      return ethersUtils.parseEther(this.amountPerRecipient);
    },
    getVisibleRequests(): [string, EthRequestData][] {
      if(this.onlyLowBalances === false){
        return Object.entries(this.ethRequests);
      }
      return Object.entries(this.ethRequests).filter(e => e[1].balance !== null && e[1].balance.lt(this.parsedAmountPerRecipient));
    },
    truncatedBalance(): BigNumber {
      if(!this.current.balance) return BigNumber.from(0);
      const remainder = this.current.balance.mod(1e8);
      return this.current.balance.sub(remainder);
    }
  },
	methods: {
    createMessage(content: string): Message {
      return { id: this.current.count++, content: content }
    },
    toggleShown(panel: string){
      this.shown = (panel === this.shown) ? "" : panel;
      window.location.hash = this.shown;
    },
		initializeWeb3() {
      this.web3provider = markRaw(new Web3Provider((window as any).ethereum));
      this.signer = markRaw(this.web3provider.getSigner());
      this.ETHToken.contract = markRaw(new Contract(zkUtils.ETH_ADDRESS, zkUtils.IERC20, this.signer));
      this.ETHDistributor.contract = markRaw(new Contract(
        this.ETHDistributor.address, new ethersUtils.Interface(this.ETHDistributor.abi), this.signer
      ));
      console.log("Initialized providers, signers, & contracts")
		},
    initializeWebSocket() {
      this.ws = markRaw(new WebSocket(`wss://${this.ETHDistributor.HOST}/websocket`));
      if(this.ws === null){
        alert("Couldn't connect to websocket server: Please refresh.");
        this.errors.push(this.createMessage("Couldn't connect to websocket server: Please refresh."));
      } else {
        this.ws.onopen = (event)=>{
          console.log("Websocket opened: " + new Date(Date.now()));
        };
        this.ws.onmessage = (event)=>{
          let payload = JSON.parse(event.data);
          switch(guessServerPayloadType(payload)){
            case ServerPayloadType.RESPONSE: {
              if(WSResponseIsValid(payload)){
                switch(payload.event){
                  case ServerEvent.SEND_NONCE:
                    this.current.nonce = payload.response;
                    break;
                  case ServerEvent.CONNECTED:
                    this.successes.push(this.createMessage("Signed in as " + payload.response));
                    break;
                  case ServerEvent.A_CHANGED:
                    this.successes.push(this.createMessage("Address changed to " + payload.response));
                    break;
                  case ServerEvent.S_RESPONSE:
                    if(/^\d+$/.test(payload.response)){
                      this.successes.push(this.createMessage(`Request has been broadcasted to ${payload.response} receivers.`));
                      break;
                    }
                    switch(payload.response){
                      case "Open": case "Closed":
                        this.current.receiverOpen = payload.response === "Open";
                        this.successes.push(this.createMessage("Request receiver is now " + payload.response.toLowerCase()));
                        break;
                      default:
                        this.errors.push(this.createMessage("Websocket error: Unknown response"));
                        break;
                    }
                    break;
                  case ServerEvent.S_R_REQUEST:
                    if(!eth_address_regex.test(payload.response)){
                      console.error("Received response is not an address: " + payload.response);
                      this.errors.push(this.createMessage("Websocket error: Unknown response - not an address"));
                    } else {
                      (async (address)=>{
                        this.abortIfUnitialized(!this.web3provider || !this.signer);
                        let balance = await this.web3provider!.getBalance(address);
                        if(!this.onlyLowBalances || (this.onlyLowBalances && balance.lt(this.parsedAmountPerRecipient))){
                          this.ethRequests[address] = this.createEthRequestData(balance);
                        }
                      })(payload.response);
                    }
                    break;
                  case ServerEvent.DISCONNECT:
                    this.errors.push(this.createMessage("Error: Server connection disconnected. Reloading page in 5 seconds."));
                    setTimeout(()=>{ window.location.reload(); }, 5000);
                    break;
                  case ServerEvent.ERROR: default:
                    console.error("Error: " + payload.response);
                    this.errors.push(this.createMessage("Error: " + payload.response));
                    break;
                }
                this.locks.websocket = false;
              }
            } break;
            case ServerPayloadType.HB: {
              if(this.ws === null){
                console.error("Heartbeat error: Websocket doesn't exist");
                this.errors.push(this.createMessage("Error: No websocket connection detected. Reloading page in 5 seconds."));
                setTimeout(()=>{ window.location.reload(); }, 5000);
              } else {
                this.ws.send(HEARTBEAT_FRAME);
              }
            } break;
            case ServerPayloadType.NOT_A_PAYLOAD: default: {
              console.error("Payload parsing error");
            } break;
          }
        };
        this.ws.onerror = (event)=>{
          console.error(event);
          this.errors.push(this.createMessage(event.toString()));
        };
      }
    },
    

    createEthRequestData(_balance: BigNumber): EthRequestData {
      return { lock: false, balance: _balance }
    },
    abortIfUnitialized(encounteredProblem: boolean): void {
      if(encounteredProblem){
        this.errors.push(this.createMessage("App not properly initialized! Please refresh this page."));
        throw "App uninitialized";
      }
    },
		async getFee() {
      this.abortIfUnitialized(!this.web3provider || !this.signer || !this.ETHToken.contract || !this.ETHDistributor.contract);
      const gasPrice = await this.signer!.getGasPrice();
      const feeInGas = await this.ETHDistributor.contract!.estimateGas.distributeETH(this.selectedRequests, this.parsedAmountPerRecipient);
			return ethersUtils.formatUnits(feeInGas.mul(gasPrice), this.ETHToken.decimals);
		},
    async getBalanceOfRequesters(){
      this.abortIfUnitialized(!this.web3provider || !this.signer);
      for(let address in this.ethRequests){
        (async (address)=>{
          this.ethRequests[address].lock = true;
          this.ethRequests[address].balance = await this.web3provider!.getBalance(address);
          this.ethRequests[address].lock = false;
        })(address);
      }
    },
		async getBalance() {
      this.abortIfUnitialized(!this.web3provider || !this.signer);
			// Getting the balance for the signer in the selected token
			const balanceInUnits = await this.signer!.getBalance();
			// To display the number of tokens in the human-readable format, we need to format them,
			// e.g. if balanceInUnits returns 500000000000000000 wei of ETH, we want to display 0.5 ETH the user
			return balanceInUnits;
		},
    async getApprovedAmount() {
      this.abortIfUnitialized(!this.web3provider || !this.signer || !this.ETHToken.contract);
      const approvedAmount = await this.ETHToken.contract!.allowance(await this.signer!.getAddress(), this.ETHDistributor.address);
			return ethersUtils.formatUnits(approvedAmount, this.ETHToken.decimals);
    },
    approveOneMoreETH(){
      (async ()=>{
        let increaseHandler: types.TransactionResponse = await this.ETHToken.contract!.approve(
          this.ETHDistributor.address, ethersUtils.parseEther(this.current.approvedAmount).add(ethersUtils.parseEther("1"))
        );
        this.successes.push(this.createMessage("Submitted ETH approval transaction"));
        increaseHandler.wait().then((waitForCommit: TransactionReceipt)=>{
          console.log(`Approve ETH - Confirmed (TxHash: ${waitForCommit.transactionHash})`);
          this.successes.push(this.createMessage(`Approved 1 more ETH for distribution. TxHash: ${waitForCommit.transactionHash}`));
        });
        this.updateApprovedAmount(); 
      })().catch(e => {
        if(e.code === 4001){
          this.warnings.push(this.createMessage("ETH Approval transaction cancelled"));
        } else {
          this.errors.push(this.createMessage(`ETH approval Error: ${e}`));
        }
      });
    },
    async sufficientApprovedETH(requiredAmount: BigNumber) {
      try{
        const approvedAmount: BigNumber = await this.ETHToken.contract!.allowance(await this.signer!.getAddress(), this.ETHDistributor.address);
        return approvedAmount.gte(requiredAmount);
      }catch(e){
        return false;
      }
    },
    sendTestnetETHSync(){
      this.sendTestnetETH().catch(err=>{}).finally(()=>{
        this.txStatus = TxStatus.IDLE;
      });
    },
		async sendTestnetETH() {
      this.abortIfUnitialized(!this.web3provider || !this.signer || !this.ETHToken.contract || !this.ETHDistributor.contract);
      const minAmount = this.parsedAmountPerRecipient.mul(this.selectedRequests.length).add(this.ETHDistributor.minETH);
      if(!(await this.sufficientApprovedETH( minAmount ))){
        try{
          this.txStatus = TxStatus.SUBMITTING_APPROVAL;
          let approvalHandler: types.TransactionResponse = await this.ETHToken.contract!.approve(
            this.ETHDistributor.address, 
            minAmount
          );
          this.successes.push(this.createMessage("Submitted ETH approval transaction"));
          this.txStatus = TxStatus.AWAITING_APPROVAL_COMMIT;
          approvalHandler.wait().then((waitForCommit: TransactionReceipt)=>{
            console.log(`Approve ETH - Confirmed (TxHash: ${waitForCommit.transactionHash})`);
            this.successes.push(this.createMessage(`Approved ${minAmount} more ETH for distribution. TxHash: ${waitForCommit.transactionHash}`));
          });
        }catch(e: any){
          if(e.code && e.code === 4001){
            this.warnings.push(this.createMessage("ETH Approval transaction cancelled"));
          } else {
            this.errors.push(this.createMessage(`ETH approval Error: ${e}`));
          }
          throw e;
        }
      }
      if(await this.sufficientApprovedETH( minAmount )){
        try{
          const addressesNum = this.selectedRequests.length;
          this.txStatus = TxStatus.SUBMITTING_TRANSFER;
          let transferHandler = await this.ETHDistributor.contract!.distributeETH(this.selectedRequests, this.parsedAmountPerRecipient);
          this.txStatus = TxStatus.AWAITING_TRANSFER_COMMIT;
          this.selectedRequests.forEach(address=>{
            delete this.ethRequests[address];
          })
          this.selectedRequests = [];
          transferHandler.wait().then((waitForCommit: TransactionReceipt)=>{
            console.log(`Sent ETH - Confirmed (TxHash: ${waitForCommit.transactionHash})`);
            this.successes.push(this.createMessage(`Distributed ETH to ${addressesNum} addresses. TxHash: ${waitForCommit.transactionHash}`));
          });
          this.successes.push(this.createMessage(`Submitted distributeETH() transaction.`))
        } catch(e: any){
          if(e.code && e.code === 4001){
            this.warnings.push(this.createMessage("ETH Distribution transaction cancelled"));
          } else {
            this.errors.push(this.createMessage(`distributeETH() Error: ${e}`));
          }
          throw e;
        }
      } else {
        alert("Insufficient approved ETH");
      }
      this.updateBalance();
      this.updateFee();
			this.txStatus = TxStatus.IDLE;
		},

		updateFee() {
      if(this.locks.fee){
        this.warnings.push(this.createMessage("Estimated fee is already being updated - Please wait.")); return;
      }
			this.locks.fee = true;
			this.getFee().then((fee) => { this.current.fee = fee; this.txFeeIsCalculable = true; })
			.catch(e =>{ 
        if(e.code === -32603){ 
          this.txFeeIsCalculable = false; 
          this.warnings.push(this.createMessage("There was a problem with estimating the gas fee: There likely wasn't enough approved ETH."));
        } 
      }).finally(() => { this.locks.fee = false; });
		},
		updateBalance() {
      if(this.locks.balance){
        this.warnings.push(this.createMessage("Address balance is currently being refreshed - Please wait.")); return;
      } 
			this.locks.balance = true;
			this.getBalance().then((balance) => { this.current.balance = balance; })
			.catch(e => console.error(e)).finally(() => { this.locks.balance = false; });
		},
    updateApprovedAmount() {
      if(this.locks.approval){
        this.warnings.push(this.createMessage("Approved amount is currently being refreshed - Please wait.")); return;
      } 
      this.locks.approval = true;
      this.getApprovedAmount().then((approvedAmount) => { this.current.approvedAmount = approvedAmount; })
			.catch(e => console.error(e)).finally(() => { this.locks.approval = false; });
    },
		connectMetamask() {
      if (this.correctNetwork) {
        (window as any).ethereum.request({ method: 'eth_requestAccounts' }).then(() => {
          this.loadMainScreen();
        }).catch((e: any) => console.log(e)); 
      } else {
        (window as any).ethereum.request({ method: 'wallet_switchEthereumChain', params: [ { "chainId": "0x118" } ]}).then(()=>{
          (window as any).ethereum.request({ method: 'eth_requestAccounts' }).then(() => {
            this.loadMainScreen();
          }).catch((e: any) => console.log(e)); 
        }).catch((e: any)=>{
          if(e.code === 4902 || e.code === -32603){
            (window as any).ethereum.request({ method: 'wallet_addEthereumChain', params: [ { 
              "chainId": "0x118",
              "chainName": "ZkSync Testnet - Goerli",
              "rpcUrls": [ "https://zksync2-testnet.zksync.dev" ],
              "iconUrls": [ "https://zksync.io/favicon.ico" ],
              "nativeCurrency": { "name": "ETH", "symbol": "ETH", "decimals": 18 },
              "blockExplorerUrls": [ "https://zksync2-testnet.zkscan.io/" ],
            } ]}).then(()=>{
              (window as any).ethereum.request({ method: 'eth_requestAccounts' }).then(() => {
                this.loadMainScreen();
              }).catch((e: any) => console.log(e)); 
            });
          } 
          this.errors.push(this.createMessage(`Unknown error: ${e.code} - ${e.message} `));
        });
      }
		},
		loadMainScreen() {
			this.initializeWeb3();

			if(!this.signer) {
				this.errors.push(this.createMessage("Follow the tutorial to learn how to connect to Metamask!"));
				return;
			}
      this.signer.getAddress().then(address => {
        this.current.address = address;
        this.initializeWebSocket();
        this.SIWELogin();
      });
      this.updateBalance();
      this.updateFee();
      this.updateApprovedAmount();
		},  
    recheckAddress(){
      this.abortIfUnitialized(!this.signer);
      this.signer!.getAddress().then(address => {
        if(this.current.address !== address){
          this.current.address = address;
        }
        this.updateFee();
        this.updateBalance();
        this.updateApprovedAmount();
      });
    },
    backToTop(){
      document.body.scrollTop = 0;
    },
    selectAllVisibleRequests(){
      this.selectedRequests = this.getVisibleRequests.map(e=>e[0]);
      [...document.querySelectorAll("input.address-checkbox[type=checkbox]")].forEach(e=>{
        (e as HTMLInputElement).checked = this.selectedRequests.includes(e.id);
      });
      this.updateFee();
    },
    updateAPR(event: Event){
      this.amountPerRecipient = (event.target! as HTMLInputElement).value;
    },
    updateOLB(event: Event){
      this.onlyLowBalances = (event.target! as HTMLInputElement).checked;
    },
    addAddressToSR(event: Event, address: string){
      if((event.target! as HTMLInputElement).checked){
        this.selectedRequests = [...(new Set(this.selectedRequests.concat(address)))];
      } else {
        this.selectedRequests = this.selectedRequests.filter(a=>a !== address);
      }
      this.updateFee();
    },

    
    WSSend(payload: ClientPayload | SIWEPayload, logging_text: string ){
      if(this.locks.websocket){
        this.errors.push(this.createMessage(`Error: Websocket currently being used - Please wait.` )); return;
      }
      this.abortIfUnitialized(!this.ws);
      until(()=>this.ws!.readyState === this.ws!.OPEN).then(()=>{
        console.log(logging_text);
        this.locks.websocket = true;
        this.ws!.send(JSON.stringify(payload));
      });
    },
    // WS Send Events (3 available)
    broadcastRequest(){
      this.WSSend({event: ClientEvent.R_BC_REQUEST}, "Broadcasting request");
    },
    toggleReceiver(toggleTo: ClientEvent.S_OPEN_RECEIVER | ClientEvent.S_CLOSE_RECEIVER){
      this.WSSend({event: toggleTo}, "Toggling receiver mode to " + (toggleTo === ClientEvent.S_OPEN_RECEIVER ? "Open" : "Closed"));
    },
    SIWELogin(addressChanged: boolean = false){
      this.abortIfUnitialized(!this.ws || !this.signer);
      // Wait until nonce has been changed
      this.signer!.getAddress().then(address => {
        if(this.current.address !== address){
          this.errors.push(this.createMessage("Error: Address mismatch - Refreshing."));
          window.location.reload();
        }
        const previousNonce = this.current.nonce;
        console.log("Waiting for nonce");
        until(()=>{ return previousNonce !== this.current.nonce }).then(async ()=>{
          this.abortIfUnitialized(
            !this.ws || !this.web3provider || !this.signer || !this.current.address || !eth_address_regex.test(this.current.address)
          );
          console.log("Starting SIWE logic");
          try {
            // TODO: login & re-login logic
            let message = (new SiweMessage({
              domain: this.ETHDistributor.HOST,
              address: this.current.address!,
              statement: SIWEMessageDetails.statement,
              uri: `https://${this.ETHDistributor.HOST}`,
              version: '1',
              chainId: SIWEMessageDetails.chainId,
              nonce: this.current.nonce!,
              issuedAt: (new Date()).toISOString(),
              expirationTime: (new Date(Date.now() + 1000 * 60 * SIWEMessageDetails.cutOffInMinutes)).toISOString(),
            })).prepareMessage();
            let signature = await this.signer!.signMessage(message);
            // Send out nonce request: Response will be handled by ws.onmessage
            this.WSSend({ message: message, signature: signature }, "Sending SIWE");
          } catch (e: any) {
            if(e.code === 4001) {
              this.errors.push(this.createMessage(`Error: SIWE signing was rejected.` ));
            }
          }
        });
      });
      // Send out nonce request: Response will be handled by ws.onmessage
      this.WSSend({event: ClientEvent.GET_NONCE}, "Requesting nonce");
    },
    
    expireSuccessMessage(message: Message){
      this.successes.splice(this.successes.indexOf(message), 1)
    },
    expireWarningMessage(message: Message){
      this.warnings.splice(this.warnings.indexOf(message), 1)
    },
    expireErrorMessage(message: Message){
      this.errors.splice(this.errors.indexOf(message), 1)
    },

	}
}
</script>

<style>
  body { background-color: lightgrey;}
  button { padding: 0.35em; }

	#app {
		font-family: Avenir, Helvetica, Arial, sans-serif;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		color: #2c3e50;
    margin: 0 auto;
	}

  .nowrap { white-space: nowrap; }

  .flexify { display: flex; }
  .flexify > hr { width: 100%; border: 1px solid black; }
  .flexify.flex-center { justify-content: center; }
  .flexify.flex-column { flex-direction: column; flex-wrap: wrap; }
  .flexify.align-center { align-content: center; }
  .flexify.flex-column > * { margin: 0.2em; }
  .flexify.flex-end { align-items: flex-end; }

	.error { color: red; }
  label.error-message::before { content: "❌"; }
  .error-border { border: 2px solid red; }

  label.success::before { content: "✔️"; }
  .success-border { border: 2px solid green; }

  label.warning:before { content: "⚠️"; }
  .warning-border { border: 2px solid rgb(228, 167, 54); }

	.main-box {
		text-align: left;
		width: fit-content;
    margin: 2em auto 10vh auto;
	}

  .connect-overlay { 
    z-index: 2; 
    opacity: 0.5; 
    background-color: black; 
    position: fixed; top: 0; left: 0; 
    width: 100vw; height: 100vh;
  }

  .msg-overlay { 
    z-index: 4; 
    position: fixed; top: 0; left: 5%;
    margin: 2em auto 10vh auto;
    width: 90%;
  }

  .msg-overlay > div { 
    min-width: 40vw;
    width: fit-content;
  }

  .msg-overlay > div.success { 
    background-color: rgb(202, 255, 202);
  }

  .msg-overlay > div.warning, .warning-bg-color { 
    background-color: rgb(255, 228, 139);
  }

  .msg-overlay > div.error { 
    background-color: rgb(255, 226, 226);
  }

	.start-screen {
    z-index: 3;
		margin: 0 auto;
    border: 10px solid rgb(255, 132, 0);
    background-color: rgb(214, 252, 138);
    position: fixed; top: 2vh; 
    left: calc( (100% - 40vw) / 2 );
    width: calc(40vw - 6em);
    padding: 1em 3em;
    flex-flow: column;
	}

  a.navbar-link {
    padding: 0.3em;
    border: 1px solid grey;
    transition: all 0.3s ease 0s;
    background-color: white;
    text-decoration: none;
  }

  a.navbar-link:hover {
    transform: translateY(-2px);
    box-shadow: 2px 2px 2px 0px rgba(0,0,0,0.75);
  }
  a.navbar-link.active { border-color: black; background-color: lightblue; }

  .request-portion, .sender-portion {
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    align-content: center;
    flex-direction: column;
  }

  #request-eth, #send-eth { border: 1px solid grey; padding: 10px; }

  .tx-section { min-height: 8em; justify-content: center; }

	.top-spacing  { margin-top:  1em; }
	.left-spacing { margin-left: 1em; }

  .middle-align-text { text-align: center; }

  input#amountPerRecipient { width: 5em; }

  button.eth-requests { margin: 0 auto; }

  table#requests-table { border-spacing: 0px; width: 100%; }
  table#requests-table thead { display: none; }

  table#requests-table tr { display: block; border: 1px solid black; }
  table#requests-table tr + tr { border-top-width: 0px; }

  table#requests-table td:nth-of-type(2) div { padding: 0.3em; }
  table#requests-table td:nth-of-type(2) div + div { border-top: 1px solid black; }
  table#requests-table td:nth-of-type(2) div:before { font-weight: bold; padding-right: 10px; }
  table#requests-table td:nth-of-type(2) div:nth-of-type(1):before { content: "Address"; }
  table#requests-table td:nth-of-type(2) div:nth-of-type(2):before { content: "Balance"; }

  @media (max-width: 600px) {
    .start-screen {
      width: calc(80% - 4em);
      left: calc( (100% - 80% - 1em) / 2 );
      padding: 1em 2em;
    }

    a.navbar-link {
      width: 80%;
    }

    div.header {
      width: 90%;
      margin: 0 auto;
    }

    span.address, table#requests-table td:nth-of-type(2) label {
      line-break: anywhere;
    }

    table#requests-table td:nth-of-type(2) div { font-size: 0.8em; }
  }
</style>
