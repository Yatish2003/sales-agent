import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  awsRegion: process.env.AWS_REGION ?? "",
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioWhatsappNumber:
    process.env.TWILIO_WHATSAPP_NUMBER ?? process.env.TWILIO_WHATSAPP_FROM ?? "",
  twilioWebhookUrl: process.env.TWILIO_WEBHOOK_URL ?? "",
  emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  instagramVerifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? "",
  instagramPageAccessToken: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ?? "",
  instagramAppSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
  googleCalendarClientEmail: process.env.GOOGLE_CALENDAR_CLIENT_EMAIL ?? "",
  googleCalendarPrivateKey: (process.env.GOOGLE_CALENDAR_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  googleCalendarPriyaId: process.env.GOOGLE_CALENDAR_PRIYA_ID ?? "",
  googleCalendarMarcusId: process.env.GOOGLE_CALENDAR_MARCUS_ID ?? "",
};

export function assertServerEnv() {
  const missing: string[] = [];
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!env.awsRegion) missing.push("AWS_REGION");
  if (!env.bedrockModelId) missing.push("BEDROCK_MODEL_ID");
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}
