export type NormalizedInbound = {
  channel: "EMAIL" | "WHATSAPP" | "INSTAGRAM";
  externalContactId: string;
  displayName?: string;
  content: string;
  timestamp: Date;
  externalMessageSid?: string;
};

export type ChannelSender = (to: string, body: string) => Promise<void>;
