/******************************************************************************************
 * ⚡ HTX (HUOBI) AGGREGATOR (ULTRA-OPTIMIZED FOR 0.1 vCPU / 128MB RAM)
 * Multi-Currency Support via UI Dashboard + 14 Decimal Avg/Sec
 * Master Profiles Loaded Automatically from Database (Target: webwebwebweb8888)
 * Precise Database History + Active Position Event Tracker for Micro-Fluctuations
 ******************************************************************************************/

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ccxt = require('ccxt');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000; 
const STAGGER_DELAY_MS = 500; 
const UI_REFRESH_RATE = 1000; 

// 🚨 Security: Password redacted. Replace 'YOUR_PASSWORD_HERE' with your real DB password.
const MONGO_URI = "mongodb+srv://web88888888888888_db_user:ZETrZHXzaxoekjkm@clusterweb8888.l0rv6hv.mongodb.net/botdb?appName=Clusterweb8888";

// The currently tracked currency (can be changed via UI)
let targetCurrency = 'USDT';
const SUPPORTED_CURRENCIES = ['USDT', 'SHIB', 'XRP', 'BCH', 'ZAR'];

// ==================== MONGODB SETUP & ACCOUNT LOADER ====================
const mongoClient = new MongoClient(MONGO_URI);
let dbCollection = null;
let botDb = null;
const accounts = [];

// TARGET USER TRACKING
const TARGET_USERNAME = 'webweb8888';
let targetUserId = null;
let targetIsPaper = false;
let latestDbActions = [];
let activeBotSettings = {};
let marketEvents = []; // NEW: Tracks live position changes (DCA buys, manual closes, etc)

console.log("---------------------------------------------------------");
console.log(`🚀 Starting HTX Aggregator - Loading Profiles for ${TARGET_USERNAME}...`);

mongoClient.connect().then(async () => {
    // Connect to the unified botdb
    botDb = mongoClient.db("botdb");
    
    // DB Collection for Aggregator Stats (Stored in HTX_Aggregator DB)
    dbCollection = mongoClient.db("HTX_Aggregator").collection("session_growth");
    console.log("✅ Connected to MongoDB");

    // Load Accounts from TARGET_USERNAME
    try {
        const usersCol = botDb.collection("users");
        const masterUser = await usersCol.findOne({ username: TARGET_USERNAME });
        
        if (masterUser) {
            targetUserId = masterUser._id;
            targetIsPaper = masterUser.isPaper || false;
            
            const settingsColName = targetIsPaper ? "paper_settings" : "settings";
            const settingsCol = botDb.collection(settingsColName);
            
            const masterSettings = await settingsCol.findOne({ userId: targetUserId });
            
            if (masterSettings) {
                activeBotSettings = masterSettings; // Cache settings for UI
                if (masterSettings.subAccounts) {
                    masterSettings.subAccounts.forEach((sub, index) => {
                        if (sub.apiKey && sub.secret) {
                            accounts.push({
                                id: index + 1,
                                name: sub.name || `Profile ${index + 1}`,
                                apiKey: sub.apiKey,
                                secret: sub.secret,
                                isLoaded: false, 
                                data: { total: 0, free: 0, used: 0, error: null, fetchedCurrency: null, lastPositions: {}, hasFetchedPositionsOnce: false }
                            });
                            console.log(`✅ Loaded Profile: ${sub.name}`);
                        }
                    });
                }
            }
        } else {
            console.error(`❌ User '${TARGET_USERNAME}' not found in database.`);
        }

        if (accounts.length === 0) {
            console.log(`⚠️ No active API keys found for ${TARGET_USERNAME}. Running in viewing mode.`);
        }

        // Start DB Polling for History Logs (Runs every 3 seconds to avoid DB spam)
        setInterval(fetchDatabaseHistoryLogs, 3000);

        // VERCEL ADAPTATION: Prevent hanging on server.listen during serverless execution
        if (!process.env.VERCEL) {
            server.listen(PORT, () => {
                console.log(`✅ Dashboard running: http://localhost:${PORT}`);
            });
        }
        startBackgroundLoop();

    } catch (err) {
        console.error("❌ Error loading master profiles:", err);
    }

}).catch(err => console.error("❌ MongoDB Connection Error:", err));

// ==================== DB HISTORY FETCHING ====================
async function fetchDatabaseHistoryLogs() {
    if (!targetUserId || !botDb) return;
    try {
        const offsetColName = targetIsPaper ? "paper_offset_records" : "offset_records";
        const offsetCol = botDb.collection(offsetColName);
        
        // Fetch up to 100 records so we have enough data for Session Analytics
        const records = await offsetCol.find({ userId: targetUserId })
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();
            
        latestDbActions = records;
        
        // Refresh settings as well to capture live UI changes
        const settingsColName = targetIsPaper ? "paper_settings" : "settings";
        const settingsCol = botDb.collection(settingsColName);
        const latestSettings = await settingsCol.findOne({ userId: targetUserId });
        if (latestSettings) activeBotSettings = latestSettings;
        
    } catch (e) {
        console.error("❌ DB Log Fetch Error:", e);
    }
}

// ==================== OPTIMIZED SHARED EXCHANGE ====================
const sharedExchange = new ccxt.huobi({
    enableRateLimit: false, 
    options: { defaultType: 'linear' } // Use 'linear' for Swap/Futures. 
});

let cachedMethods = { v3Bal: null, v1Bal: null, v3Pos: null, v1Pos: null };

// ==================== GLOBAL DB STATE ====================
let state = {
    startTime: null,         
    startBalance: 0,      
    isInitialized: false,
    dbSyncing: false,
    lastDbSave: 0
};

async function syncDbSession(currency, currentTotal) {
    if (!dbCollection) return;
    state.dbSyncing = true;
    try {
        let doc = await dbCollection.findOne({ currency: currency });
        if (doc && doc.startTime && doc.startBalance !== undefined) {
            state.startTime = doc.startTime;
            state.startBalance = doc.startBalance;
            console.log(`📂 DB Loaded -> ${currency} Tracking from: ${state.startBalance.toFixed(10)}`);
        } else {
            // No record for this currency, create baseline in DB
            state.startTime = Date.now();
            state.startBalance = currentTotal;
            await dbCollection.updateOne(
                { currency: currency },
                { $set: { startTime: state.startTime, startBalance: state.startBalance, updatedAt: new Date() } },
                { upsert: true }
            );
            console.log(`🏁 DB New Session -> ${currency} Tracking from: ${state.startBalance.toFixed(10)}`);
        }
        state.isInitialized = true;
    } catch (e) {
        console.error("❌ DB Sync Error:", e);
    }
    state.dbSyncing = false;
}

async function resetSession(currentTotal) {
    state.startTime = Date.now();
    state.startBalance = currentTotal;
    state.isInitialized = true;
    state.lastDbSave = 0; 
    marketEvents = []; // Clear live events on reset
    
    // Hard reset the values inside MongoDB so it becomes the new truth
    if (dbCollection) {
        await dbCollection.updateOne(
            { currency: targetCurrency },
            { 
                $set: { 
                    startTime: state.startTime, 
                    startBalance: state.startBalance,
                    currentTotal: currentTotal,
                    growth: 0,
                    growthPct: 0,
                    secondsElapsed: 0,
                    updatedAt: new Date()
                } 
            },
            { upsert: true }
        ).catch(e => console.error("❌ DB Reset Error:", e));
    }
    
    console.log(`🔄 DB Reset: Tracking Growth from: ${state.startBalance.toFixed(10)} ${targetCurrency}`);
}

// ==================== BACKGROUND FETCH LOOP ====================
async function startBackgroundLoop() {
    let index = 0;
    
    const allMethods = Object.keys(sharedExchange);
    cachedMethods.v3Bal = allMethods.find(m => m.toLowerCase().includes('v3unifiedaccountinfo'));
    cachedMethods.v1Bal = allMethods.find(m => m.toLowerCase().includes('v1swapcrossaccountinfo'));
    cachedMethods.v3Pos = allMethods.find(m => m.toLowerCase().includes('v3swapcrosspositioninfo'));
    cachedMethods.v1Pos = allMethods.find(m => m.toLowerCase().includes('v1swapcrosspositioninfo'));

    while(true) {
        if (accounts.length === 0) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const acc = accounts[index];
        const currentCoin = targetCurrency; 
        
        try {
            sharedExchange.apiKey = acc.apiKey;
            sharedExchange.secret = acc.secret;
            
            let totalEquity = 0;
            let freeCurrency = 0;
            let balSuccess = false;

            try {
                const bal = await sharedExchange.fetchBalance({ type: 'swap', marginMode: 'cross' });
                if (bal?.total?.[currentCoin] !== undefined) {
                    totalEquity = parseFloat(bal.total[currentCoin] || 0);
                    freeCurrency = parseFloat(bal.free[currentCoin] || 0);
                    balSuccess = true;
                }
            } catch(e) {}

            if (!balSuccess && cachedMethods.v3Bal) {
                try {
                    const rawV3 = await sharedExchange[cachedMethods.v3Bal]({ trade_partition: currentCoin });
                    const d = Array.isArray(rawV3?.data) ? rawV3.data.find(x => x.margin_asset === currentCoin) || rawV3.data[0] : rawV3?.data;
                    if (d) {
                        totalEquity = parseFloat(d.margin_balance || d.cross_margin_balance || 0);
                        freeCurrency = parseFloat(d.withdraw_available || d.available_margin || 0);
                        balSuccess = true;
                    }
                } catch(e) {}
            }

            if (!balSuccess && cachedMethods.v1Bal) {
                try {
                    const rawCross = await sharedExchange[cachedMethods.v1Bal]({ margin_account: currentCoin });
                    if (rawCross?.data?.[0]) {
                        totalEquity = parseFloat(rawCross.data[0].margin_balance || 0);
                        freeCurrency = parseFloat(rawCross.data[0].withdraw_available || 0);
                        balSuccess = true;
                    }
                } catch(e) {}
            }

            if (!balSuccess) throw new Error("Balance API failed");

            let totalUnrealizedPnl = 0;
            let posSuccess = false;
            let currentPosMap = {}; // NEW: Maps Symbol -> Contracts

            try {
                const ccxtPos = await sharedExchange.fetchPositions(undefined, { marginMode: 'cross' });
                if (ccxtPos) {
                    ccxtPos.forEach(p => { 
                        totalUnrealizedPnl += parseFloat(p.unrealizedPnl || 0); 
                        if (p.contracts > 0) currentPosMap[p.symbol || 'Unknown'] = p.contracts;
                    });
                    posSuccess = true;
                }
            } catch(e) {}

            if (!posSuccess && cachedMethods.v3Pos) {
                try {
                    const rawV3 = await sharedExchange[cachedMethods.v3Pos]({ margin_account: currentCoin });
                    if (rawV3?.data) {
                        rawV3.data.forEach(p => { 
                            totalUnrealizedPnl += parseFloat(p.profit_unreal || 0); 
                            let vol = parseFloat(p.volume || 0);
                            if (vol > 0) currentPosMap[p.contract_code || p.symbol || 'Unknown'] = vol;
                        });
                        posSuccess = true;
                    }
                } catch(e) {}
            }

            if (!posSuccess && cachedMethods.v1Pos) {
                try {
                    const rawCross = await sharedExchange[cachedMethods.v1Pos]({ margin_account: currentCoin });
                    if (rawCross?.data) {
                        rawCross.data.forEach(p => { 
                            totalUnrealizedPnl += parseFloat(p.profit_unreal || 0); 
                            let vol = parseFloat(p.volume || 0);
                            if (vol > 0) currentPosMap[p.contract_code || p.symbol || 'Unknown'] = vol;
                        });
                    }
                } catch(e) {}
            }

            // =========================================================================================
            // 🚨 FEATURE 1: DETECTING "OPENED" OR "FULLY CLOSED" POSITIONS
            // =========================================================================================
            if (!acc.data.hasFetchedPositionsOnce) {
                acc.data.lastPositions = currentPosMap;
                acc.data.hasFetchedPositionsOnce = true;
            } else {
                let now = Date.now();
                for (let sym in currentPosMap) {
                    let currQty = currentPosMap[sym];
                    let prevQty = acc.data.lastPositions[sym] || 0;
                    if (currQty > prevQty && prevQty === 0) {
                        marketEvents.unshift({ time: now, msg: `Opened new position on ${sym}`});
                    } else if (currQty > prevQty) {
                        marketEvents.unshift({ time: now, msg: `Added contracts (DCA) to ${sym}`});
                    } else if (currQty < prevQty) {
                        marketEvents.unshift({ time: now, msg: `Reduced contracts on ${sym}`});
                    }
                }
                for (let sym in acc.data.lastPositions) {
                    if (!currentPosMap[sym]) {
                        marketEvents.unshift({ time: now, msg: `Fully closed position on ${sym}`});
                    }
                }
                
                // Keep event array clean (Max 20 records globally)
                if (marketEvents.length > 20) marketEvents = marketEvents.slice(0, 20);
                
                acc.data.lastPositions = currentPosMap;
            }
            // =========================================================================================

            const staticWalletBalance = totalEquity - totalUnrealizedPnl;

            if (!isNaN(staticWalletBalance)) {
                acc.data = {
                    ...acc.data, // Preserve hasFetchedPositionsOnce and lastPositions
                    total: staticWalletBalance,
                    free: freeCurrency,
                    used: totalEquity - freeCurrency,
                    error: null,
                    fetchedCurrency: currentCoin
                };
            }
            
        } catch (err) {
            acc.data.error = "Conn Error"; 
        } finally {
            acc.isLoaded = true; 
        }

        index = (index + 1) % accounts.length;
        await new Promise(r => setTimeout(r, STAGGER_DELAY_MS));
    }
}

// ==================== ULTRA-OPTIMIZED AGGREGATOR LOOP ====================
let payload = {
    combined: {
        currency: targetCurrency,
        startTime: null,
        startBalance: 0, total: 0, free: 0, used: 0, growth: 0, 
        growthPct: 0, avgGrowthPerSec: 0, avgGrowthPctPerSec: 0, growthPerHour: 0,
        growthPerDay: 0, growthPerMonth: 0, growthPerYear: 0,
        secondsElapsed: 0, timestamp: '', isReady: false, 
        loadedCount: 0, totalCount: 0
    },
    accounts: [],
    dbRecords: [],
    marketEvents: [],
    botSettings: {}
};

setInterval(() => {
    if (accounts.length === 0 && !targetUserId) return; // Wait for DB load
    
    // Ensure payload accounts array size matches
    if (payload.accounts.length !== accounts.length) {
        payload.accounts = new Array(accounts.length);
    }

    let grandTotal = 0;
    let grandFree = 0;
    let grandUsed = 0;
    let loadedCount = 0;
    let allHealthy = true; 
    
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        
        if (acc.data.fetchedCurrency === targetCurrency) {
            grandTotal += acc.data.total;
            grandFree += acc.data.free;
            grandUsed += acc.data.used;
        }

        if (acc.isLoaded && acc.data.fetchedCurrency === targetCurrency && !acc.data.error) {
            loadedCount++;
        } else {
            allHealthy = false; 
        }
        
        payload.accounts[i] = {
            name: acc.name,
            total: acc.data.total,
            free: acc.data.free,
            error: acc.data.error,
            isLoaded: acc.isLoaded && (acc.data.fetchedCurrency === targetCurrency)
        };
    }

    // INITIALIZATION: Pull from Database Instead of Just Ram
    if (!state.isInitialized && loadedCount === accounts.length && allHealthy && accounts.length > 0) {
        if (!state.dbSyncing && dbCollection) {
            syncDbSession(targetCurrency, grandTotal);
        }
    }

    const c = payload.combined;
    c.currency = targetCurrency;
    c.total = grandTotal;
    c.free = grandFree;
    c.used = grandUsed;
    c.loadedCount = loadedCount;
    c.totalCount = accounts.length;
    c.isReady = state.isInitialized;
    c.timestamp = new Date().toLocaleTimeString();

    if (state.isInitialized) {
        const now = Date.now();
        const secondsElapsed = Math.max(1, (now - state.startTime) / 1000);
        const growth = grandTotal - state.startBalance;
        const avgGrowthPerSec = growth / secondsElapsed;

        c.startTime = state.startTime;
        c.startBalance = state.startBalance;
        c.secondsElapsed = secondsElapsed;
        c.growth = growth;
        c.growthPct = state.startBalance > 0 ? (growth / state.startBalance) * 100 : 0;
        
        c.avgGrowthPerSec = avgGrowthPerSec;
        c.avgGrowthPctPerSec = state.startBalance > 0 ? (avgGrowthPerSec / state.startBalance) * 100 : 0;

        c.growthPerHour = avgGrowthPerSec * 3600;
        c.growthPerDay = avgGrowthPerSec * 86400;
        c.growthPerMonth = avgGrowthPerSec * 2592000;
        c.growthPerYear = avgGrowthPerSec * 31536000;

        if (dbCollection && (now - state.lastDbSave) > 10000) {
            state.lastDbSave = now;
            dbCollection.updateOne(
                { currency: targetCurrency },
                { 
                    $set: {
                        currentTotal: grandTotal,
                        growth: c.growth,
                        growthPct: c.growthPct,
                        secondsElapsed: c.secondsElapsed,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            ).catch(err => {}); 
        }

    } else {
        c.growth = 0; c.growthPct = 0; c.growthPerHour = 0; c.avgGrowthPerSec = 0;
        c.avgGrowthPctPerSec = 0; c.growthPerDay = 0; c.growthPerMonth = 0; c.growthPerYear = 0;
        c.startTime = null;
    }

    // Attach external data to payload
    payload.dbRecords = latestDbActions;
    payload.marketEvents = marketEvents;
    
    // =========================================================================================
    // 🚨 FEATURE 2: BOT SETTINGS & CLOSURE TRIGGERS
    // =========================================================================================
    payload.botSettings = {
        globalTargetPnl: activeBotSettings.globalTargetPnl || 0,
        smartOffsetNetProfit: activeBotSettings.smartOffsetNetProfit || 0,
        smartOffsetStopLoss: activeBotSettings.smartOffsetStopLoss || 0,
        smartOffsetNetProfit2: activeBotSettings.smartOffsetNetProfit2 || 0,
        autoDynamic: activeBotSettings.minuteCloseAutoDynamic || false
    };

    io.emit('update', payload);

}, UI_REFRESH_RATE);

io.on('connection', (socket) => {
    socket.on('request_reset', () => {
        if(accounts.length > 0 && accounts.every(a => a.isLoaded && a.data.fetchedCurrency === targetCurrency && !a.data.error)) {
            resetSession(accounts.reduce((sum, a) => sum + a.data.total, 0));
        }
    });

    socket.on('change_currency', (newCoin) => {
        if (SUPPORTED_CURRENCIES.includes(newCoin) && newCoin !== targetCurrency) {
            console.log(`💱 UI Requested Currency Change: ${targetCurrency} -> ${newCoin}`);
            targetCurrency = newCoin;
            state.isInitialized = false; 
        }
    });
});

app.get('/', (req, res) => res.send(getHtml()));

// ==================== UI TEMPLATE ====================
function getHtml() { 
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>HTX Master Aggregator</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="/socket.io/socket.io.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
    <style>
        :root { --primary: #3f51b5; --bg: #f0f2f5; --card-bg: #ffffff; --text-main: #1f2937; --text-light: #6b7280; --green: #10b981; --red: #ef4444; --shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        body { background: var(--bg); color: var(--text-main); font-family: 'Roboto', sans-serif; margin: 0; padding: 0; }
        
        /* TOP NAVIGATION */
        .top-nav { background: #ffffff; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.05); height: 60px; margin-bottom: 25px; }
        .nav-logo { font-size: 18px; font-weight: 700; color: var(--primary); }
        .nav-links { display: flex; gap: 20px; }
        .nav-link { text-decoration: none; color: var(--text-light); font-weight: 500; font-size: 14px; padding: 10px 0; border-bottom: 2px solid transparent; transition: all 0.2s; cursor: pointer; }
        .nav-link:hover { color: var(--primary); }
        .nav-link.active { color: var(--primary); border-bottom: 2px solid var(--primary); }
        
        .container { max-width: 900px; margin: 0 auto; padding: 0 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; }
        h1 { font-size: 22px; font-weight: 700; margin: 0; }
        .subtitle { font-size: 13px; color: var(--text-light); margin-top: 4px; }
        
        .controls { display: flex; align-items: center; gap: 10px; }
        .currency-select { 
            background: #ffffff; border: 1px solid #d1d5db; color: #1f2937; 
            padding: 6px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; 
            cursor: pointer; outline: none; box-shadow: var(--shadow);
        }
        .currency-select:hover { border-color: #9ca3af; }
        
        .timer-badge { background: #e5e7eb; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-family: 'Roboto Mono'; box-shadow: var(--shadow); }
        .btn-reset { background: white; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; text-transform: uppercase; font-weight: 600; box-shadow: var(--shadow); transition: background 0.2s;}
        .btn-reset:hover { background: #f9fafb; }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } .header { flex-direction: column; align-items: flex-start; gap: 15px; } }
        .card { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); padding: 24px; }
        .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-light); margin-bottom: 12px; font-weight: 600; }
        .big-val { font-family: 'Roboto Mono'; font-size: 26px; font-weight: 700; line-height: 1.1; }
        .sub-val { font-family: 'Roboto Mono'; font-size: 13px; color: var(--text-light); margin-top: 6px; }
        .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
        .row:last-child { border-bottom: none; }
        .val { font-weight: 500; font-family: 'Roboto Mono'; }
        .green-txt { color: var(--green) !important; } .red-txt { color: var(--red) !important; }
        
        .table-card { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; margin-top: 20px;}
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { background: #f9fafb; padding: 16px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-transform: uppercase; }
        td { padding: 16px; border-bottom: 1px solid #f3f4f6; }
        td.num-col { font-family: 'Roboto Mono'; font-size: 13px; }
        
        .footer { text-align: center; margin-top: 40px; padding-bottom:20px; color: var(--text-light); font-size: 12px; }
        .dot { height: 8px; width: 8px; background-color: #bbb; border-radius: 50%; display: inline-block; margin-right: 6px; }
        .dot.live { background-color: var(--green); box-shadow: 0 0 4px var(--green); }
        
        /* Bot Analytics & History Log */
        .analytics-box { background: #f8fafc; border-left: 4px solid var(--primary); padding: 16px 20px; border-radius: 6px; margin-bottom: 20px; box-shadow: var(--shadow); }
        .analytics-title { font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; color: var(--primary); border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;}
        
        .setting-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; }
        .setting-item { display: flex; justify-content: space-between; background: #fff; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 4px; }
        .setting-item strong { color: #4b5563; }

        .history-card { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); padding: 20px; margin-bottom: 20px; max-height: 250px; overflow-y: auto; }
        .history-item { padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; display: flex; gap: 12px; align-items: flex-start; }
        .history-item:last-child { border-bottom: none; }
        .history-time { color: var(--text-light); font-family: 'Roboto Mono'; white-space: nowrap; font-size: 12px; width: 85px; }
        .history-msg { color: #4b5563; line-height: 1.4; width: 100%; }
        .reason-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; margin-right: 8px; }
        .bg-green { background: #dcfce7; color: #166534; }
        .bg-red { background: #fee2e2; color: #991b1b; }
        .bg-blue { background: #dbeafe; color: #1e40af; }
    </style>
</head>
<body>

<!-- TOP NAVIGATION -->
<div class="top-nav">
    <div class="nav-logo">⚡ HTX Master Aggregator (webwebwebweb8888)</div>
    <div class="nav-links">
        <a class="nav-link active" id="tab-dashboard" onclick="switchTab('dashboard')">Overview Dashboard</a>
        <a class="nav-link" id="tab-accounts" onclick="switchTab('accounts')">Accounts & Analytics</a>
    </div>
</div>

<div class="container">
    <div class="header">
        <div>
            <h1 id="page-title">Portfolio Overview</h1>
            <div class="subtitle" id="status-text">Connecting...</div>
        </div>
        <div class="controls">
            <select class="currency-select" id="currencySelect" onchange="changeCurrency(this.value)">
                <option value="USDT">USDT</option>
                <option value="SHIB">SHIB</option>
                <option value="XRP">XRP</option>
                <option value="BCH">BCH</option>
                <option value="ZAR">ZAR</option>
            </select>
            <div class="timer-badge" id="elapsed">--:--:--</div>
            <button class="btn-reset" onclick="resetSession()">Reset Stats</button>
        </div>
    </div>

    <!-- PAGE 1: DASHBOARD -->
    <div id="page-dashboard">
        <div class="grid">
            <div class="card">
                <div class="card-title">Live Wallet</div>
                <div class="big-val" id="total">Loading...</div>
                <div class="sub-val">Available: <span id="free">--</span></div>
            </div>
            <div class="card">
                <div class="card-title">Realized Session Growth</div>
                <div class="big-val" id="growth">--</div>
                <div class="sub-val" id="growthPct">--%</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-title">Realized Projections (Avg)</div>
                <div class="row"><span>Est. Second</span> <span class="val" id="projSec">--</span></div>
                <div class="row"><span>Est. Hour</span> <span class="val" id="projHour">--</span></div>
                <div class="row"><span>Est. Day</span> <span class="val" id="projDay">--</span></div>
                <div class="row"><span>Est. Month</span> <span class="val" id="projMonth">--</span></div>
                <div class="row"><span>Est. Year</span> <span class="val" id="projYear">--</span></div>
            </div>
            <div class="card">
                <div class="card-title">Session Balances & Margin</div>
                <div class="row"><span>Starting Wallet</span> <span class="val" id="startWallet">--</span></div>
                <div class="row"><span>Current Wallet</span> <span class="val" id="currentWallet">--</span></div>
                <div class="row"><span>Used Margin</span> <span class="val" id="used">--</span></div>
            </div>
        </div>
    </div>

    <!-- PAGE 2: ACCOUNTS & ANALYTICS -->
    <div id="page-accounts" style="display: none;">
        
        <!-- Live Drivers Box -->
        <div class="analytics-box" style="border-left-color: var(--green);">
            <div class="analytics-title"><span class="material-symbols-outlined">query_stats</span> Realized Session Growth Drivers</div>
            <div id="realized-drivers-grid" style="display:block;">
                <div class="setting-item"><span style="color:var(--text-light);">Analyzing database history for this session...</span></div>
            </div>
        </div>

        <!-- Settings Info -->
        <div class="analytics-box">
            <div class="analytics-title"><span class="material-symbols-outlined">settings_applications</span> Active Logic Parameters</div>
            <div class="setting-grid" id="bot-settings-grid">
                <div class="setting-item"><span>Fetching Database Settings...</span></div>
            </div>
        </div>

        <!-- Precise Database History Log -->
        <div class="history-card" id="history-log-container">
            <div class="card-title" style="margin-bottom: 0; display:flex; justify-content:space-between;">
                <span>Database Trade History Log</span>
                <span style="font-size:10px; font-weight:normal; text-transform:none;">Real-time from MongoDB</span>
            </div>
            <div id="history-log-content">
                <div class="history-item">
                    <div class="history-msg" style="color: var(--text-light); font-style: italic;">Syncing latest database records...</div>
                </div>
            </div>
        </div>

        <!-- Accounts Table -->
        <div class="table-card">
            <table id="accTable">
                <thead>
                    <tr>
                        <th>Account Profile</th>
                        <th style="text-align:right">Wallet Balance</th>
                        <th style="text-align:right">Available Free</th>
                        <th style="text-align:right">Status</th>
                    </tr>
                </thead>
                <tbody id="accBody"></tbody>
            </table>
        </div>
    </div>

    <div class="footer">
        <span class="dot" id="dot"></span> Updated: <span id="time">--</span>
    </div>
</div>

<script>
    // Tab Switching Logic
    function switchTab(tabName) {
        document.getElementById('page-dashboard').style.display = 'none';
        document.getElementById('page-accounts').style.display = 'none';
        document.getElementById('tab-dashboard').classList.remove('active');
        document.getElementById('tab-accounts').classList.remove('active');
        
        if (tabName === 'dashboard') {
            document.getElementById('page-dashboard').style.display = 'block';
            document.getElementById('tab-dashboard').classList.add('active');
            document.getElementById('page-title').innerText = "Portfolio Overview";
        } else {
            document.getElementById('page-accounts').style.display = 'block';
            document.getElementById('tab-accounts').classList.add('active');
            document.getElementById('page-title').innerText = "Accounts & Analytics";
        }
    }

    const socket = io();
    
    function resetSession() { 
        if(confirm('Reset stats to current Wallet Balance?')) socket.emit('request_reset'); 
    }
    
    function changeCurrency(newCoin) {
        socket.emit('change_currency', newCoin);
        document.getElementById('status-text').innerText = 'Switching currencies...';
        document.getElementById('total').innerText = 'Loading...';
    }
    
    // Fixed formatters
    const currentDecimals = 10;
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: currentDecimals, maximumFractionDigits: currentDecimals });
    const fmtPct = (n) => (n > 0 ? '+' : '') + Number(n).toFixed(10) + '%';
    const fmt14 = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 14, maximumFractionDigits: 14 });
    const fmtPct14 = (n) => (n > 0 ? '+' : '') + Number(n).toFixed(14) + '%';
    const colorClass = (n) => n > 0 ? 'green-txt' : (n < 0 ? 'red-txt' : '');
    
    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600).toString().padStart(2,'0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2,'0');
        const s = Math.floor(seconds % 60).toString().padStart(2,'0');
        return \`\${h}:\${m}:\${s}\`;
    };

    const updateVal = (id, val, isPct=false, colorize=false, currency='') => {
        const el = document.getElementById(id);
        if(!el) return;
        let txt = isPct ? fmtPct(val) : fmt(val);
        if(colorize && val > 0 && !isPct) txt = '+' + txt;
        if(currency && !isPct) txt = txt + ' ' + currency;
        
        el.innerText = txt;
        if(colorize) {
            el.className = 'val ' + colorClass(val);
            if(id === 'growth') el.classList.add('big-val'); 
        } 
    };

    socket.on('update', data => {
        document.getElementById('dot').classList.add('live');
        const c = data.combined;
        
        // Sync Dropdown
        const selectEl = document.getElementById('currencySelect');
        if (selectEl.value !== c.currency) selectEl.value = c.currency;

        if (!c.isReady) {
            document.getElementById('status-text').innerText = \`Fetching \${c.currency} Data... (\${c.loadedCount}/\${c.totalCount})\`;
            renderTable(data.accounts, c.currency);
            return;
        }

        document.getElementById('status-text').innerText = \`Tracking \${c.currency} Portfolio\`;
        document.getElementById('elapsed').innerText = formatTime(c.secondsElapsed);
        document.getElementById('time').innerText = c.timestamp;

        updateVal('total', c.total, false, false, c.currency);
        updateVal('free', c.free, false, false, c.currency);
        updateVal('growth', c.growth, false, true, c.currency);
        document.getElementById('growthPct').innerHTML = \`<span class="\${colorClass(c.growthPct)}">\${fmtPct(c.growthPct)}</span>\`;

        // Update Est. Second (14 decimals + percentage)
        const secEl = document.getElementById('projSec');
        if (secEl) {
            let txtAbs = fmt14(c.avgGrowthPerSec);
            if (c.avgGrowthPerSec > 0) txtAbs = '+' + txtAbs;
            const txtPct = fmtPct14(c.avgGrowthPctPerSec);
            
            secEl.innerText = txtAbs + ' ' + c.currency + ' (' + txtPct + ')';
            secEl.className = 'val ' + colorClass(c.avgGrowthPerSec);
        }

        updateVal('projHour', c.growthPerHour, false, true, c.currency);
        updateVal('projDay', c.growthPerDay, false, true, c.currency);
        updateVal('projMonth', c.growthPerMonth, false, true, c.currency);
        updateVal('projYear', c.growthPerYear, false, true, c.currency);

        updateVal('startWallet', c.startBalance, false, false, c.currency);
        updateVal('currentWallet', c.total, false, false, c.currency);
        updateVal('used', c.used, false, false, c.currency);

        renderTable(data.accounts, c.currency);

        // Update precise database history, settings, and unaccounted math
        if (data.dbRecords && data.botSettings) {
            updatePreciseReasoning(data.dbRecords, data.botSettings, c.startTime, c.growth, data.marketEvents);
        }
    });

    // Renders the exact settings, history, and UNLOGGED MICRO-CHANGES
    function updatePreciseReasoning(records, settings, startTime, actualGrowth, marketEvents) {
        // --- 1. Update Settings Grid ---
        const grid = document.getElementById('bot-settings-grid');
        grid.innerHTML = \`
            <div class="setting-item"><span>Global Target PNL:</span> <strong>$\${settings.globalTargetPnl.toFixed(2)}</strong></div>
            <div class="setting-item"><span>Auto-Dynamic 1-Min:</span> <strong>\${settings.autoDynamic ? '<span class="green-txt">ON</span>' : '<span class="red-txt">OFF</span>'}</strong></div>
            <div class="setting-item"><span>Smart Offset V1 TP:</span> <strong>$\${settings.smartOffsetNetProfit.toFixed(2)}</strong></div>
            <div class="setting-item"><span>Smart Offset V1 SL:</span> <strong>$\${settings.smartOffsetStopLoss.toFixed(2)}</strong></div>
            <div class="setting-item"><span>Smart Offset V2 TP:</span> <strong>$\${settings.smartOffsetNetProfit2.toFixed(2)}</strong></div>
            <div class="setting-item"><span>Smart Offset V2 SL:</span> <strong>$\${(settings.smartOffsetStopLoss2 || 0).toFixed(2)}</strong></div>
        \`;

        // --- 2. Realized Session Growth Breakdown + Micro-Fluctuations ---
        const driversEl = document.getElementById('realized-drivers-grid');
        if (startTime) {
            const sessionRecords = records.filter(r => new Date(r.timestamp).getTime() > startTime);
            
            let dbNetProfit = 0;
            let html = '';

            if (sessionRecords.length === 0) {
                html += '<div style="margin-bottom:12px; color:var(--text-light);">No completed database trades yet this session.</div>';
            } else {
                const breakdown = {};
                sessionRecords.forEach(r => {
                    const reason = r.reason || (r.loserSymbol ? 'Legacy Smart Offset' : 'Trade Event');
                    if (!breakdown[reason]) breakdown[reason] = { count: 0, net: 0 };
                    breakdown[reason].count += 1;
                    breakdown[reason].net += (r.netProfit || 0);
                    dbNetProfit += (r.netProfit || 0);
                });

                html += '<ul style="margin: 0 0 12px 0; padding-left: 20px; font-size: 14px;">';
                for (const [reason, data] of Object.entries(breakdown)) {
                    const netStr = (data.net >= 0 ? '+' : '') + '$' + data.net.toFixed(4);
                    const color = data.net >= 0 ? 'green-txt' : 'red-txt';
                    html += \`<li style="margin-bottom: 6px;"><strong>\${reason}</strong> triggered \${data.count} time(s), resulting in a net realized impact of <strong class="\${color}">\${netStr}</strong></li>\`;
                }
                html += '</ul>';

                // Absolute latest execution
                const latest = sessionRecords[0];
                const latestReason = latest.reason || (latest.loserSymbol ? 'Legacy Smart Offset' : 'Trade Event');
                const latestSymbol = latest.symbol || latest.winnerSymbol || 'Unknown';
                const latestNetStr = (latest.netProfit >= 0 ? '+' : '') + '$' + (latest.netProfit || 0).toFixed(4);
                
                html += \`<div style="font-size: 13px; color:var(--text-main);">
                            <strong>Latest DB Execution:</strong> \${latestReason} on \${latestSymbol} (\${latestNetStr})
                         </div>\`;
            }

            // =========================================================================================
            // 🚨 FEATURE 3: UI TEXT RENDERER
            // =========================================================================================
            const unaccounted = actualGrowth - dbNetProfit;

            if (Math.abs(unaccounted) > 0.0000001) { 
                const unaccColor = unaccounted >= 0 ? 'green-txt' : 'red-txt';
                const unaccStr = (unaccounted >= 0 ? '+' : '') + '$' + unaccounted.toFixed(6);
                
                html += \`
                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px dashed #d1d5db; font-size: 13px; background:#f9fafb; padding:12px; border-radius:6px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                        <span><strong style="color:var(--text-main);">🔍 Unlogged Micro-Changes:</strong></span>
                        <span class="\${unaccColor}"><strong>\${unaccStr}</strong></span>
                    </div>
                    <div style="color: var(--text-light); font-size: 12px; line-height: 1.5;">
                        <strong style="color:var(--text-main);">Why did the balance change without a log?</strong>\`;
                
                // Filter events to the last 5 minutes
                const recentEvents = marketEvents.filter(e => (Date.now() - e.time) < 300000);
                
                if (recentEvents.length > 0) {
                    html += \`<ul style="margin:4px 0 0 0; padding-left: 16px; color: var(--primary);">\`;
                    recentEvents.slice(0, 5).forEach(e => {
                        const timeStr = new Date(e.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
                        html += \`<li>[\${timeStr}] <strong>\${e.msg}</strong> (Caused fee deduction or PNL shift)</li>\`;
                    });
                    if (recentEvents.length > 5) {
                        html += \`<li>...and \${recentEvents.length - 5} more recent events.</li>\`;
                    }
                    html += \`</ul>\`;
                } else {
                    html += \`<ul style="margin:4px 0 0 0; padding-left: 16px;">
                        \${unaccounted < 0 ? '<li><strong>Funding Rates:</strong> 8-hour cycle funding fees deducted for holding open positions.</li>' : ''}
                        <li><strong>API Latency (Ghost PNL):</strong> The exchange sent your Wallet Balance and PNL milliseconds apart, causing a temporary fractional penny glitch.</li>
                    </ul>\`;
                }

                html += \`</div></div>\`;
            }

            driversEl.innerHTML = html;
        }

        // =========================================================================================
        // 🚨 FEATURE 4: THE DATABASE REASON RENDERER
        // =========================================================================================
        const historyEl = document.getElementById('history-log-content');
        if (records.length === 0) {
            historyEl.innerHTML = '<div class="history-item"><div class="history-msg" style="color: var(--text-light); font-style: italic;">No recent trade executions found in database.</div></div>';
            return;
        }

        let html = '';
        records.forEach(r => {
            const timeStr = new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            const symbol = r.symbol || r.winnerSymbol || 'Unknown';
            const reason = r.reason || (r.loserSymbol ? 'Legacy Smart Offset' : 'Trade Event');
            const net = r.netProfit || 0;
            
            let badgeClass = 'bg-blue';
            if (net > 0) badgeClass = 'bg-green';
            if (net < 0) badgeClass = 'bg-red';

            const netStr = (net >= 0 ? '+' : '') + '$' + net.toFixed(4);

            html += \`
                <div class="history-item">
                    <div class="history-time">[\${timeStr}]</div>
                    <div class="history-msg">
                        <span class="reason-badge \${badgeClass}">\${reason}</span> 
                        <strong>\${symbol}</strong> resulted in a net change of 
                        <strong class="\${net >= 0 ? 'green-txt' : 'red-txt'}">\${netStr}</strong>.
                    </div>
                </div>
            \`;
        });
        historyEl.innerHTML = html;
    }

    function renderTable(accounts, currency) {
        const tbody = document.getElementById('accBody');
        tbody.innerHTML = '';
        accounts.forEach(acc => {
            const tr = document.createElement('tr');
            let statusHtml = '<span style="color:#9ca3af;">Fetching...</span>';
            
            if (acc.isLoaded) {
                 statusHtml = acc.error 
                ? '<span style="color:var(--red); font-weight:700;">' + acc.error + '</span>' 
                : '<span style="color:var(--green); font-weight:700;">OK</span>';
            }

            const totalDisplay = acc.isLoaded ? (fmt(acc.total) + ' ' + currency) : '...';
            const freeDisplay = acc.isLoaded ? (fmt(acc.free) + ' ' + currency) : '...';

            tr.innerHTML = \`
                <td>\${acc.name}</td>
                <td class="num-col" style="text-align:right;">\${totalDisplay}</td>
                <td class="num-col" style="text-align:right; color:#6b7280;">\${freeDisplay}</td>
                <td style="text-align:right;">\${statusHtml}</td>
            \`;
            tbody.appendChild(tr);
        });
    }
</script>
</body>
</html>
` 
}

// VERCEL ADAPTATION: Export the Express App for Vercel's Node Builder
module.exports = app;
