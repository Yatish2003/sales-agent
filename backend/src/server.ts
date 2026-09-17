import express from "express";
import cors from "cors";
import helmet from "helmet";
import { assertServerEnv, env } from "./env.js";
import { leadsRouter } from "./routes/leads.js";
import { calendarRouter } from "./routes/calendar.js";
import { agentsRunRouter } from "./routes/agents.run.js";
import { agentsResetRouter } from "./routes/agents.reset.js";
import { emailWebhookRouter } from "./routes/webhooks.email.js";
import { whatsappWebhookRouter } from "./routes/webhooks.whatsapp.js";
import { instagramWebhookRouter } from "./routes/webhooks.instagram.js";

assertServerEnv();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/leads", leadsRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/agents/reset", agentsResetRouter);
app.use("/api/agents", agentsRunRouter);
app.use("/api/webhooks/email", emailWebhookRouter);
app.use("/api/webhooks/whatsapp", whatsappWebhookRouter);
app.use("/api/webhooks/instagram", instagramWebhookRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const prismaGone = "code" in err && (err as { code?: string }).code === "P1001";
    res.status(prismaGone ? 503 : 500).json({
      error: prismaGone ? "database_unreachable" : "internal_error",
      message: err.message,
    });
  },
);

const host = process.env.HOST ?? "::";

app.listen(env.port, host, () => {
  console.log(`Mudita backend listening on ${host}:${env.port} (CORS ${env.frontendOrigin})`);
});
