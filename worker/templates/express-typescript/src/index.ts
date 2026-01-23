import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (_req, res) => {
  res.json({ message: `Welcome to ${config.appName}` });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// Start server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

export { app };
