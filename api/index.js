import express from "express";
// import fs from "fs";   // commented out as before

const app = express();
app.use(express.json());

app.get("/ping", (req, res) => {
  res.json({ ok: true });
});

// Shared handler logic
const depthHandler = async (req, res) => {
  const { mark } = req.params;

  const requests = {
    "binance-spot": `https://api4.binance.com/api/v3/depth?symbol=${mark}USDT&limit=1000`,
    "binance-linear": `https://fapi.binance.com/fapi/v1/depth?symbol=${mark}USDT&limit=1000`,
    "binance-inverse": `https://dapi.binance.com/dapi/v1/depth?symbol=${mark}USD_PERP&limit=1000`,
    "bybit-spot": `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${mark}USDT&limit=1000`,
    "bybit-linear": `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${mark}USDT&limit=1000`,
    "bybit-inverse": `https://api.bybit.com/v5/market/orderbook?category=inverse&symbol=${mark}USDT&limit=1000`,
    "gate-futures": `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${mark}_USDT&limit=300`,
    "gate-spot": `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${mark}_USDT&limit=300`,
    "okx-spot": `https://www.okx.com/api/v5/market/books?instId=${mark}-USDT&sz=300`,
    "okx-perp": `https://www.okx.com/api/v5/market/books?instId=${mark}-USDT-SWAP&sz=300`,
  };

  const resss = []; // you can keep or remove this if not used later

  try {
    const responses = await Promise.allSettled(
      Object.entries(requests).map(async ([name, url]) => {
        try {
          const resFetch = await fetch(url);
          if (!resFetch.ok) {
            throw new Error(`HTTP ${resFetch.status}`);
          }
          const data = await resFetch.json();
          resss.push(data);
          return { name, success: true, data };
        } catch (err) {
          const er = { name, success: false, error: err.message };
          console.warn(JSON.stringify(er)); // or your log function
          return { name, success: false, error: err.message };
        }
      }),
    );

    const allAsks = [];
    const allBids = [];
    const each = {};

    for (const result of responses) {
      if (result.status !== "fulfilled" || !result.value.success) {
        continue;
      }

      const { name, data } = result.value;

      let asks = [];
      let bids = [];

      try {
        if (name.startsWith("binance")) {
          asks = data.asks || [];
          bids = data.bids || [];
        } else if (name.startsWith("bybit")) {
          asks = data.result?.a || data.result?.list?.[0]?.a || [];
          bids = data.result?.b || data.result?.list?.[0]?.b || [];
        } else if (name.startsWith("gate-spot")) {
          asks = data.asks?.map((item) => [item[0], item[1]]) || [];
          bids = data.bids?.map((item) => [item[0], item[1]]) || [];
        } else if (name.startsWith("gate-futures")) {
          asks = data.asks?.map((r) => [r.p, r.s]) || [];
          bids = data.bids?.map((r) => [r.p, r.s]) || [];
        } else if (name.startsWith("okx")) {
          asks = data.data?.[0]?.asks || [];
          bids = data.data?.[0]?.bids || [];
        }
      } catch (parseErr) {
        console.warn(`Parse error in ${name}: ${parseErr.message}`);
        continue;
      }

      each[name] = { asks, bids };
      allAsks.push(...asks);
      allBids.push(...bids);
    }

    if (allAsks.length === 0 && allBids.length === 0) {
      return res.status(503).json({
        error: "No valid order book data from any exchange",
        mark,
      });
    }

    let totalAskQty = 0;
    let totalBidQty = 0;
    const askMap = new Map();
    const bidMap = new Map();

    allAsks.forEach(([priceStr, qtyStr]) => {
      const price = Number(priceStr);
      const qty = Number(qtyStr);
      if (!isNaN(price) && !isNaN(qty) && qty > 0) {
        askMap.set(price, (askMap.get(price) || 0) + qty);
        totalAskQty += qty;
      }
    });

    allBids.forEach(([priceStr, qtyStr]) => {
      const price = Number(priceStr);
      const qty = Number(qtyStr);
      if (!isNaN(price) && !isNaN(qty) && qty > 0) {
        bidMap.set(price, (bidMap.get(price) || 0) + qty);
        totalBidQty += qty;
      }
    });

    const asks = [...askMap.entries()]
      .map(([price, amount]) => ({ price, amount }))
      .sort((a, b) => a.price - b.price);

    const bids = [...bidMap.entries()]
      .map(([price, amount]) => ({ price, amount }))
      .sort((a, b) => b.price - a.price);

    res.json({ asks, bids, totalAskQty, totalBidQty, ...each });
  } catch (fatalErr) {
    console.error("Critical error in /depth endpoint:", fatalErr);
    res.status(500).json({
      error: "Internal server error while fetching order books",
      message: fatalErr.message,
    });
  }
};

// Attach the same handler to both GET and POST
app.route("/depth/:mark").get(depthHandler).post(depthHandler);

export default app;
