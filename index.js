import app from "./api/depth/[mark].js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Test: http://localhost:${PORT}/depth/BTC`);
});
