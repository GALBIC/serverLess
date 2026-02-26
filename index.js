import express from "express";
import fs from "fs";
const app = express();

app.use(express.json());

app.get("/ping", (req, res) => {
  res.json({ ok: true });
});
function logToFile(message) {
  // Get call stack
  const stack = new Error().stack.split("\n");
  // Parse the caller information (index 2 because 0 is Error, 1 is this function)
  const callerLine = stack[2] || "";

  // Extract file and line number (format: at function (file:line:column))
  const match = callerLine.match(/\(?(.+?):(\d+):\d+\)?$/) || [];
  const file = match[1] ? path.basename(match[1]) : "unknown";
  const line = match[2] || "unknown";

  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  const logEntry = `${timestamp} [${file}:${line}] (${currentChatId || "N/A"})| ${message}\n`;

  // Append to log file
  fs.appendFileSync(path.join(__dirname, "logs.txt"), logEntry, "utf8");
}
app.post("/depth/:mark", async (req, res) => {
  const { mark } = req.params;

  const requests = {
    // Binance spot
    "binance-spot": `https://api4.binance.com/api/v3/depth?symbol=${mark}USDT&limit=1000`,
    // Binance USDT-M futures
    "binance-linear": `https://fapi.binance.com/fapi/v1/depth?symbol=${mark}USDT&limit=1000`,

    // Binance COIN-M futures
    "binance-inverse": `https://dapi.binance.com/dapi/v1/depth?symbol=${mark}USD_PERP&limit=1000`,

    // Bybit spot
    "bybit-spot": `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${mark}USDT&limit=1000`,

    // Bybit linear perpetual
    "bybit-linear": `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${mark}USDT&limit=1000`,

    // Bybit inverse perpetual
    "bybit-inverse": `https://api.bybit.com/v5/market/orderbook?category=inverse&symbol=${mark}USDT&limit=1000`,

    // Gate.io futures USDT
    "gate-futures": `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${mark}_USDT&limit=300`,

    // Gate.io spot
    "gate-spot": `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${mark}_USDT&limit=300`,

    // OKX spot
    "okx-spot": `https://www.okx.com/api/v5/market/books?instId=${mark}-USDT&sz=300`,

    // OKX perpetual (most are linear/USDT)
    "okx-perp": `https://www.okx.com/api/v5/market/books?instId=${mark}-USDT-SWAP&sz=300`,
  };
  const resss = [];
  try {
    const responses = await Promise.allSettled(
      Object.entries(requests).map(async ([name, url]) => {
        try {
          //   const controller = new AbortController();
          //   const timeoutId = setTimeout(() => controller.abort(), 20000); // 7s timeout

          const res = await fetch(url, {
            // signal: controller.signal,
          });
          //   clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const data = await res.json();
          resss.push(data);
          return { name: name, success: true, data };
        } catch (err) {
          const er = { name: name, success: false, error: err.message };
          logToFile(JSON.stringify(er));

          return { name: name, success: false, error: JSON.stringify(err) };
        }
      }),
    );
    fs.writeFileSync("responses.json", JSON.stringify(resss, null, 2));
    // ── Collect valid order books ───────────────────────────────────────
    const allAsks = [];
    const allBids = [];
    const each = {};

    for (const result of responses) {
      if (result.status !== "fulfilled" || !result.value.success) {
        console.warn(
          `Failed to fetch ${result.value?.name || "unknown"}: ${JSON.stringify(result, null, 2)}`,
        );
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
          asks = data.result?.a || [];
          bids = data.result?.b || [];
        } else if (name.startsWith("gate-spot")) {
          asks = data.asks.map((r) => [r.price, r.amount]) || [];
          bids = data.bids.map((r) => [r.price, r.amount]) || [];
        } else if (name.startsWith("gate-futures")) {
          asks = data.asks.map((r) => [r.p, r.s]) || [];
          bids = data.bids.map((r) => [r.p, r.s]) || [];
        } else if (name.startsWith("okx")) {
          asks = data.data?.[0]?.asks || [];
          bids = data.data?.[0]?.bids || [];
        }
      } catch (parseErr) {
        console.warn(`Parse error in ${name}: ${parseErr.message}`);
        continue;
      }
      console.log(name);
      console.log(asks);
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
    fs.writeFileSync("debug_asks.json", JSON.stringify(allAsks, null, 2));
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

    // Convert to sorted arrays
    const asks = [...askMap.entries()]
      .map(([price, amount]) => ({ price, amount }))
      .sort((a, b) => a.price - b.price);

    const bids = [...bidMap.entries()]
      .map(([price, amount]) => ({ price, amount }))
      .sort((a, b) => b.price - a.price);

    // res.json({ asks, bids, totalAskQty, totalBidQty });
    res.json({ asks, bids, totalAskQty, totalBidQty, ...each });
  } catch (fatalErr) {
    console.error("Critical error in /depth endpoint:", fatalErr);
    res.status(500).json({
      error: "Internal server error while fetching order books",
      message: fatalErr.message,
    });
  }
});
app.listen(3000, () => {
  console.log("Trade helper server running on port 3000");
});
