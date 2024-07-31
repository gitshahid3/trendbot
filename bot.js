const TelegramBot = require('node-telegram-bot-api');
const { MongoClient, ServerApiVersion } = require('mongodb');
const TonWeb = require('tonweb');
const { LocalStorage } = require('node-localstorage');
const emojiRegex = require('emoji-regex');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const cheerio = require('cheerio');

const ls = new LocalStorage('./db');

const uri = "mongodb+srv://newuser:mongodb@cluster0.56cbcxk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const nacl = TonWeb.utils.nacl;

const provider = new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', { apiKey: 'c71972cc7849aeaa505697be4ebdf8bcf93dc3320d79561b9382f09627357dec' })
const tonweb = new TonWeb(provider);
const WalletClass = tonweb.wallet.all.v4R2;

const token = '7023115426:AAGgU12EUOIy07KPWcz6VYQL787cIjQA-uo';
const channelId = '@hhfffffyf';
const botUrl = 'https://t.me/crypto_trendingbot';
const bot = new TelegramBot(token, { polling: true });

puppeteer.use(StealthPlugin());

const slots = [
    { amount: '0.025', expiry: '3600', tier: '3' },
    { amount: '0.05', expiry: '3600', tier: '2' },
    { amount: '0.051', expiry: '7200', tier: '3' },
    { amount: '0.1', expiry: '3600', tier: '1' },
    { amount: '0.11', expiry: '7200', tier: '2' },
    { amount: '0.2', expiry: '7200', tier: '1' },
]

// slot limits from tier 1 to tier 3 in order
const slotLimits = [3, 7, 5];

const masterWallet = "0QA69S01e6HVbZSKvVOIh8WANp2zN504oF9M0eL7BLXehTU8";

async function generateWallet() {
    const keyPair = nacl.sign.keyPair();
    const secretKey = keyPair.secretKey;
    const publicKey = keyPair.publicKey;
    const wallet = new WalletClass(tonweb.provider, {
        publicKey: publicKey
    });

    const address = await wallet.getAddress();
    return [address.toString(true, true, true), TonWeb.utils.bytesToHex(publicKey), TonWeb.utils.bytesToHex(secretKey)];
}

async function sendTon(fromPubkey, fromSecretkey, toAddress, amount, isFirstTx) {
    await client.connect();
    const db = client.db('tgbot')
    const wallets = db.collection('wallets');
    const depWallet = await wallets.findOne({ pk: fromPubkey });
    const fromPublicKeyBytes = TonWeb.utils.hexToBytes(fromPubkey);
    const fromSecretKeyBytes = TonWeb.utils.hexToBytes(fromSecretkey);
    const wallet = new WalletClass(provider, {
        publicKey: fromPublicKeyBytes,
        secretKey: fromSecretKeyBytes
    });
    let seqno = await wallet.methods.seqno().call();
    let newAmount;
    let i = 0;
    let lastSeqno = depWallet.seqno;
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        seqno = await wallet.methods.seqno().call();
        if (seqno != lastSeqno) {
            await wallets.updateOne({ pk: fromPubkey }, { $set: { seqno: seqno } });
            break;
        } else if (i >= 20) {
            throw "error";
        }
        i++;
    }
    if (isFirstTx) {
        newAmount = TonWeb.utils.toNano(amount) - TonWeb.utils.toNano('0.0024') - TonWeb.utils.toNano('0.0051');
    } else {
        newAmount = TonWeb.utils.toNano(amount) - TonWeb.utils.toNano('0.0024');
    }
    const transfer = wallet.methods.transfer({
        secretKey: fromSecretKeyBytes,
        toAddress: new TonWeb.utils.Address(toAddress),
        seqno: seqno !== null ? seqno : 0,
        sendMode: 3,
        amount: newAmount,
        payload: null
    });
    const tx = await transfer.send();
    return tx;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeDexTools(address, browser) {
    await client.connect();
    const db = client.db('tgbot')
    const meta = db.collection('meta');
    const leaderboard = db.collection('leaderboard');

    let metaData = [];
    let newBuys = [];
    let tokenName;
    let hourpt = [];
    const url = 'https://www.dextools.io/app/en/ton/pair-explorer/' + address;
    
    try {
        const page = await browser.newPage();
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.80 Safari/537.36';
        await page.setUserAgent(userAgent);
        // Navigate to the URL
        await page.goto(url , {
            waitUntil: 'domcontentloaded',
        });

        // Wait for the content to be fully loaded
        await page.waitForSelector('.datatable-row-wrapper');
        //await page.waitForSelector('.ng-tns-c1390365347-7');
        const htmlContent = await page.content();
        const $ = cheerio.load(htmlContent);
        let buyElements = []
        let txns = []
        $('.datatable-body-cell').each((_, element) => {
            buyElements.push($(element).text());   
        });
        $('a.ms-2').each((_, element) => {
            let href = $(element).prop('href');
            if (href.includes('https://tonviewer.com/transaction/')) {
                txns.push(href);
            }
        });
        let cleanArray = buyElements.filter((element, index) => {
            return (index % 10 !== 4 && index % 10 !== 9);
        });
        let refinedArray = [];
        let j = 0
        for (let i = 0; i < cleanArray.length; i += 8) {
            let chunk = cleanArray.slice(i, i + 8);
            if (chunk.includes('buy')) {
                chunk.push(txns[i/8 - j]);
                refinedArray.push(chunk);
            } else {
                txns.splice(i/8 - j, 1)
                j++;
            }
        }
        const lastBuy = await meta.findOne({ tokenAddressForLastData : address});
        let lastTx;
        if (lastBuy) {
            refinedArray.forEach((value) => {
                if (!lastTx) {
                    if (value[8] != lastBuy.lastTx) {
                        newBuys.push(value);
                    } else if (newBuys[0]) {
                        lastTx = newBuys[0][8];
                    } else {
                        lastTx = lastBuy.lastTx;
                    }
                }
            }) 
        } else {
            lastTx = refinedArray[0][8]
            newBuys = refinedArray;
        }
        await meta.updateOne({tokenAddressForLastData : address} , { $set : {lastTx : lastTx}}, { upsert: true });
        $('.ng-tns-c1390365347-7').each((_, element) => {
            metaData.push($(element).text());   
        });
        $('div[_ngcontent-ng-c3793636540]').each((index, element) => {
            if (index == 7) {
                hourpt = $(element).text().slice(1, -2);
            }
        });
        tokenName = $('.token-full-name').text();
    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }
    if (hourpt != "-") {
        await leaderboard.updateOne({ tokenAddress : address}, { $set : { tokenName: tokenName, hourpt : Number(hourpt), timestamp : Math.ceil(Date.now()/1000) }});
    }
    if (metaData[14] && metaData[17] && metaData[32]) {
        await meta.updateOne({ tokenAddressForLastData : address}, { $set : { mc : metaData[14], liq : metaData[17], vol : metaData[32]}}, { upsert : true });
        await client.close();
        return [newBuys, [metaData[14], metaData[17], metaData[32]]];
    } else {
        const lastData = await meta.findOne({ tokenAddressForLastData : address});
        await client.close();
        if (lastData) {
            return [newBuys, tokenName, [lastData.mc, lastData.liq, lastData.vol]];
        } else {
            return [newBuys, tokenName, null];
        }
    }
}

async function displayLeaderboard() {
    await client.connect();
    const db = client.db('tgbot');
    const leaderboard = db.collection('leaderboard');
    const tierOne = await leaderboard.find({ tier : '1'}).sort({hourpt: -1}).toArray();
    const tierTwo = await leaderboard.find({ tier : '2'}).sort({hourpt: -1}).toArray();
    const tierThree = await leaderboard.find({ tier : '3'}).sort({hourpt: -1}).toArray();
    let leaderboardArray = [];
    tierOne.forEach((value) => {
        leaderboardArray.push([value.tokenName, value.hourpt]);
    })
    tierTwo.forEach((value) => {
        leaderboardArray.push([value.tokenName, value.hourpt])
    })
    tierThree.forEach((value) => {
        leaderboardArray.push([value.tokenName, value.hourpt])
    })
    return leaderboardArray;
}

function clearUserId(userId) {
    ls.removeItem('input.cashin.ca.' + userId.toString());
    ls.removeItem('input.cashin.ra.' + userId.toString());
    ls.removeItem('input.cashin.emoji.' + userId.toString());
    ls.removeItem('input.cashin.amtemoji.' + userId.toString());
    ls.removeItem('input.cashin.tglink.' + userId.toString());
    ls.removeItem('expiry.' + userId.toString());
}

function findEmojis(text, entities) {
    let def;
    let custom;
    const regex = emojiRegex();
    for (const match of text.matchAll(regex)) {
        const emoji = match[0];
        def = emoji;
        break;
    }
    if (entities) {
        for (let entity of entities) {
            if (entity.type === 'custom_emoji') {
                custom = `![👍](tg://emoji?id=${entity.custom_emoji_id})`;
                break;
            }
        }
    }
    return def || custom;
}

async function cashin(chatId, userId, photoLink, isPhoto) {
    await client.connect();
    const db = client.db('tgbot');
    const wallets = db.collection('wallets');
    const tokensDb = db.collection('tokens');
    const leaderboard = db.collection('leaderboard');
    const depWallet = await wallets.findOne({ tgid: userId });
    const sendersAddress = ls.getItem('input.cashin.ra.' + userId.toString());
    const tokenAddress = ls.getItem('input.cashin.ca.' + userId.toString());
    const emoji = ls.getItem('input.cashin.emoji.' + userId.toString());
    const amtemoji = ls.getItem('input.cashin.amtemoji.' + userId.toString());
    const tglink = ls.getItem('input.cashin.tglink.' + userId.toString());
    if (sendersAddress && tokenAddress) {
        try {
            clearUserId(userId);
            await updateTokens();
            const secTokenExists = await tokensDb.findOne({ tokenAddress: tokenAddress });
            const bal = await tonweb.getBalance(depWallet.address);
            if (bal > 0) {
                let slotId;
                let isLast = false;
                for (let i = 0; i < slots.length; i++) {
                    if (bal < (slots[i].amount * 1000000000) || isLast) {
                        if (!isLast) {
                            slotId = i - 1;
                        }
                        const isSlotAvailable = await checkAvailableSlot(slots[slotId].tier);
                        if (secTokenExists && secTokenExists.tier != slots[slotId].tier) {
                            bot.sendMessage(chatId, 'Error! Token already exists with different tier wait for its expiry.');
                        } else if (!isSlotAvailable) {
                            bot.sendMessage(chatId, 'Error! No slots available for current tier.');
                        } else if (slotId >= 0) {
                            let isFirstTx = false;
                            if (!depWallet.init) {
                                const wallet = new WalletClass(provider, {
                                    publicKey: TonWeb.utils.hexToBytes(depWallet.pk),
                                    secretKey: TonWeb.utils.hexToBytes(depWallet.sk)
                                });
                                const deploy = wallet.deploy(TonWeb.utils.hexToBytes(depWallet.sk));
                                await deploy.send();
                                wallets.updateOne({ tgid: msg.from.id }, { $set: { init: true } });
                                isFirstTx = true;
                            }
                            const a = await sendTon(depWallet.pk, depWallet.sk, masterWallet, slots[slotId].amount, isFirstTx);
                            if (TonWeb.utils.toNano((bal / 1000000000).toString()).sub(TonWeb.utils.toNano(slots[slotId].amount)).gte(TonWeb.utils.toNano('0.01'))) {
                                const b = await sendTon(depWallet.pk, depWallet.sk, sendersAddress, ((bal / 1000000000) - Number(slots[slotId].amount)).toFixed(8).toString(), false);
                            }
                            if (!secTokenExists) {
                                let expiryTime = Math.ceil(Date.now() / 1000) + Number(slots[slotId].expiry);
                                await tokensDb.insertOne({ chain: "ton", tokenAddress: tokenAddress, tier: slots[slotId].tier, emoji: emoji, amtemoji: Number(amtemoji), tglink: tglink, photoLink: photoLink, isPhoto: isPhoto, expiryTime: expiryTime })
                                await leaderboard.insertOne({ chain: "ton", tokenAddress: tokenAddress, tier: slots[slotId].tier, expiryTime: expiryTime })
                                bot.sendMessage(chatId, 'Token successfully listed.');
                            } else if (slots[slotId].tier == secTokenExists.tier) {
                                await tokensDb.findOne({ tokenAddress: tokenAddress }, { $set: { expiryTime: secTokenExists.expiry + Number(slots[slotId].expiry) } });
                                await leaderboard.findOne({ tokenAddress: tokenAddress }, { $set: { expiryTime: secTokenExists.expiry + Number(slots[slotId].expiry) } });
                                bot.sendMessage(chatId, 'Token expiry extended.');
                            }
                        } else {
                            bot.sendMessage(chatId, 'Error! not enough balance found on your deposit address.');
                        }
                        break;
                    } else if ((bal / 1e9) >= slots[slots.length - 1].amount) {
                        slotId = slots.length - 1;
                        isLast = true;
                    }
                }
            } else {
                bot.sendMessage(chatId, 'Error! no balance found on your deposit address.');
            }
        } catch (error) {
            console.log(error);
            bot.sendMessage(chatId, 'Error! try repeating the command or contacting the admins.');
        }
    } else {
        bot.sendMessage(chatId, 'Error! you need to put the address of your wallet in first parameter and address of the token in the second parameter ex. "/cashin youwalletaddress tokenaddress".');
    }
}

async function updateTokens() {
    await client.connect();
    const db = client.db('tgbot');
    const tokens = db.collection('tokens');
    const leaderboard = db.collection('leaderboard');
    const tokenList = await tokens.find({ chain: 'ton' }).toArray();
    tokenList.forEach(async (token) => {
        if (token.expiryTime <= Math.ceil(Date.now() / 1000)) {
            await tokens.deleteOne({ tokenAddress: token.tokenAddress });
            await leaderboard.deleteOne({ tokenAddress: token.tokenAddress });
        }
    })
}

async function checkAvailableSlot(tier) {
    await client.connect();
    const db = client.db('tgbot');
    const leaderboard = db.collection('leaderboard');
    const tokens = await leaderboard.find({ tier: tier }).toArray();
    const limit = slotLimits[Number(tier) - 1];
    return tokens.length < limit;
}


bot.onText(/\/deposit/, async (msg) => {
    await client.connect();
    const db = client.db('tgbot');
    const wallets = db.collection('wallets');
    const depWallet = await wallets.findOne({ tgid: msg.from.id });
    const chatId = msg.chat.id;
    let address;
    if (!depWallet) {
        const newWallet = await generateWallet();
        await wallets.insertOne({ tgid: msg.from.id, address: newWallet[0], pk: newWallet[1], sk: newWallet[2], init: false, seqno: null });
        address = newWallet[0];
    } else {
        address = depWallet.address;
    }
    bot.sendMessage(chatId, 'Your deposit wallet address is ' + address + '\nafter depositing ton into it use "/cashin" command');
});

bot.onText(/\/cashin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    ls.setItem('state.' + userId.toString(), 'cashin.contractaddress');
    ls.setItem('expiry.' + userId.toString(), Math.ceil(Date.now() / 1000) + 300);
    bot.sendMessage(chatId, "Cashin process started, use /cancel to stop");
    bot.sendMessage(chatId, "Send your token contract address :");
});

bot.onText(/\/slots (.+)/, (msg, match) => {
    bot.sendMessage(msg.chat.id, match[1])
})

bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from.id;
    ls.removeItem('state.' + userId.toString());
    clearUserId(userId);
    bot.sendMessage(msg.chat.id, 'Command successfully canceled.');
})

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const params = msg.text.split(' ');
    const state = ls.getItem('state.' + userId.toString());
    let isBusy = false;

    if (ls.getItem('expiry.' + userId.toString()) >= Math.ceil(Date.now() / 1000)) {
        isBusy = true;
    } else {
        ls.removeItem('state.' + userId.toString());
        clearUserId(userId);
    }

    if (state == 'cashin.contractaddress' && isBusy) {
        ls.setItem('input.cashin.ca.' + userId.toString(), params[0]);
        bot.sendMessage(chatId, "Send your wallet address (used for refunding the coins when extra amount is sent) :");
        ls.setItem('state.' + userId.toString(), 'cashin.refundaddress');
    } else if (state == 'cashin.refundaddress' && isBusy) {
        ls.setItem('input.cashin.ra.' + userId.toString(), params[0]);
        bot.sendMessage(chatId, "Send the emoji you want to use in buybot text :");
        ls.setItem('state.' + userId.toString(), 'cashin.emoji');
    } else if (state == 'cashin.emoji' && isBusy) {
        const emoji = findEmojis(params[0], msg.entities);
        if (emoji) {
            ls.setItem('input.cashin.emoji.' + userId.toString(), emoji);
            bot.sendMessage(chatId, "Send amount of emoji u want to send per $10 :");
            ls.setItem('state.' + userId.toString(), 'cashin.amtemoji');
        } else {
            bot.sendMessage(chatId, "No emoji found.");
        }
    } else if (state == 'cashin.amtemoji' && isBusy) {
        if (Number(params[0]) > 0 && Number(params[0]) < 4) {
            ls.setItem('input.cashin.amtemoji.' + userId.toString(), params[0]);
            bot.sendMessage(chatId, "Send your telegram group/channel link :");
            ls.setItem('state.' + userId.toString(), 'cashin.tglink');
        } else {
            bot.sendMessage(chatId, "You can only send min 1 and max 3 emojis per $10");
        }
    } else if (state == 'cashin.tglink' && isBusy) {
        ls.setItem('input.cashin.tglink.' + userId.toString(), params[0]);
        bot.sendMessage(chatId, "Send your image/gif for buybot (send a photo attachment), send 'na' for no pictures :");
        ls.setItem('state.' + userId.toString(), 'cashin.photo');
    } else if (state == 'cashin.photo' && params[0] == 'na' && isBusy) {
        ls.removeItem('state.' + userId.toString());
        await cashin(chatId, userId, false);
    }
});

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let isBusy = false;

    if (ls.getItem('expiry.' + userId.toString()) >= Math.ceil(Date.now() / 1000)) {
        isBusy = true;
    } else {
        ls.removeItem('state.' + userId.toString());
        clearUserId(userId);
    }

    if (ls.getItem('state.' + userId.toString()) == 'cashin.photo' && isBusy) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        ls.removeItem('state.' + userId.toString());
        await cashin(chatId, userId, fileLink, true);
    }
})

bot.on('animation', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let isBusy = false;

    if (ls.getItem('expiry.' + userId.toString()) >= Math.ceil(Date.now() / 1000)) {
        isBusy = true;
    } else {
        ls.removeItem('state.' + userId.toString());
        clearUserId(userId);
    }

    if (ls.getItem('state.' + userId.toString()) == 'cashin.photo' && isBusy) {
        const fileId = msg.animation.file_id;
        const fileLink = await bot.getFileLink(fileId);
        ls.removeItem('state.' + userId.toString());
        await cashin(chatId, userId, fileLink, false);
    }
})

async function startTrending() {
    const db = client.db('tgbot');
    const tokens = db.collection('tokens');
    const leaderboard = db.collection('leaderboard');
    let lastLeaderboardInterval = Math.ceil(Date.now() / 1000);
    while (true) {
        try {
            await client.connect();
            const tokenList = await tokens.find({ chain : 'ton'}).toArray();
            for (let i = 0; i < tokenList.length; i++) {
                if (tokenList[i].expiryTime >= Math.ceil(Date.now() / 1000)) {
                    const browser = await puppeteer.launch({
                        defaultViewport: null,
                        headless: true,
                        ignoreHTTPSErrors: true
                    });
                    const newBuys = await scrapeDexTools(tokenList[i].tokenAddress, browser);
                    newBuys[0].forEach((value) => {
                        const emojiAmt = Math.ceil(Number(value[3].slice(1))/10) * tokenList[i].amtemoji;
                        let text;
                        if (newBuys[2] && newBuys[2][0]) {
                            text = `🚀🚀🚀<a href="${tokenList[i].tglink}">${newBuys[1]} Buy!</a>\n\n${tokenList[i].emoji.repeat(emojiAmt)}\n\n📈${value[4]} TON (${value[2]}) <b>per</b>\n💵${value[6]}TON (${value[3]})\n🔔<b>${value[5]} Tokens Bought!</b>\n🧾<a href="${value[8]}">TX on Tonviewer</a>\n\n🏦Market Cap: ${newBuys[2][0]}\n💰Liquidity: ${newBuys[2][1]}\n📊24h Volume: ${newBuys[2][2]}`;
                        } else {
                            text = `🚀🚀🚀<a href="${tokenList[i].tglink}">${newBuys[1]} Buy!</a>\n\n${tokenList[i].emoji.repeat(emojiAmt)}\n\n📈${value[4]} TON (${value[2]}) <b>per</b>\n💵${value[6]}TON (${value[3]})\n🔔<b>${value[5]} Tokens Bought!</b>\n🧾<a href="${value[8]}">TX on Tonviewer</a>`;
                        }
                        const buttons = { inline_keyboard: [[{ text: 'Start trending 🚀', url: botUrl }, { text: "Join token's telegram", url: tokenList[i].tglink }]] };
                        if (tokenList[i].photoLink && tokenList[i].isPhoto) {
                            bot.sendPhoto(channelId, tokenList[i].photoLink, {caption: text, parse_mode: 'HTML'});
                        } else if (tokenList[i].photoLink && !tokenList[i].isPhoto) {
                            bot.sendAnimation(channelId, tokenList[i].photoLink, {caption: text, reply_markup: buttons ,parse_mode: 'HTML'});
                        } else {
                            bot.sendMessage(channelId, text, {parse_mode: 'HTML'});
                        }
                        sleep(250);
                    })
                    sleep(10000);
                } else {
                    await tokens.deleteOne({tokenAddress : tokenList[i].tokenAddress});
                    await leaderboard.deleteOne({tokenAddress : tokenList[i].tokenAddress});
                }
            } 
            if (lastLeaderboardInterval + 180 <= Math.ceil(Date.now() / 1000)) {
                const leaderboardArray = await displayLeaderboard();
                let leaderboardText = `LEADERBOARD!!!\n`;
                leaderboardArray.forEach((lToken, index) => {
                    leaderboardText += `\n${(index + 1).toString()} - ${lToken[0]} | ${lToken[1].toString()}%`;
                });
                bot.sendMessage(channelId, leaderboardText);
                lastLeaderboardInterval = Math.ceil(Date.now() / 1000);
            }
        } catch (error) {
            console.log(error)
        }
    }
}

startTrending();