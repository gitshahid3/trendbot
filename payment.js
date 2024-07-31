const TonWeb = require('tonweb');
const nacl = TonWeb.utils.nacl;

const provider = new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {apiKey: 'c71972cc7849aeaa505697be4ebdf8bcf93dc3320d79561b9382f09627357dec'})
const tonweb = new TonWeb(provider);
const WalletClass = tonweb.wallet.all.v4R2;

function generateWallet() {
    const keyPair = nacl.sign.keyPair();

    const secretKey = keyPair.secretKey;
    const publicKey = keyPair.publicKey;

    console.log('Secret Key:', TonWeb.utils.bytesToHex(secretKey));
    console.log('Public Key:', TonWeb.utils.bytesToHex(publicKey));

    const wallet = new WalletClass(tonweb.provider, {
        publicKey: publicKey
    });

    wallet.getAddress().then(address => {
        console.log(address.toString(true, true, false))
        return [address.toString(true, true, true), publicKey, secretKey];
    }).catch(err => {
        return null;
    });
}

async function sendTon(fromPubkey, fromSecretkey, toAddress) {
    const fromPublicKeyBytes = TonWeb.utils.hexToBytes(fromPubkey);
    const fromSecretKeyBytes = TonWeb.utils.hexToBytes(fromSecretkey);
    const wallet = new WalletClass(provider, {
        publicKey: fromPublicKeyBytes,
        secretKey: fromSecretKeyBytes
    });
    const seqno = await wallet.methods.seqno().call();
    console.log(seqno)
    const transfer = wallet.methods.transfer({
        secretKey: fromSecretKeyBytes,
        toAddress: new TonWeb.utils.Address(toAddress),
        seqno: seqno,
        sendMode: 128,
        bounce: true,
        payload: null
    });

    const result = await transfer.send();
    console.log('Transaction Result: ', result);
}

async function getTxAmount(walletAddress, transactionHash) {
    try {
        const transactions = await provider.getTransactions(walletAddress, 1, null, transactionHash);
        if (transactions.length > 0) {
            return transactions[0].out_msgs[0].value / 1000000000;
        } else {
            console.log('Transaction not found for the provided hash.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function processDeposit(fromPubkey, fromSecretkey, walletAddress) {
    try {
        const amount = await tonweb.getBalance(walletAddress);
        await sendTon(fromPubkey, fromSecretkey, masterWallet);
    } catch (error) {
        
    }
}

sendTon();

/*Secret Key: 3784f8783859dd86a8b48b29a0fc1cd702bee2079ea56ebd36b95e6425c7dd91775f698fd169a3aca70763470013039d8cfe9621edb7acc2b00f3d6484e2fc8b
Public Key: 775f698fd169a3aca70763470013039d8cfe9621edb7acc2b00f3d6484e2fc8b
EQAdWhLDmrSVs6b2nakWVV_dJcdLUarua8XoYqCHm3ek-6DL*/