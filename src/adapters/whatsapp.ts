export interface WhatsAppMessenger { sendText(to: string, text: string): Promise<string> }

export class WhatsAppCloudClient implements WhatsAppMessenger {
  constructor(private readonly phoneNumberId: string, private readonly accessToken: string, private readonly graphVersion = "v25.0", private readonly graphBase = "https://graph.facebook.com") {}
  async sendText(to: string, text: string): Promise<string> {
    if (!/^\d{7,20}$/.test(to) || !text.trim() || text.length > 4096) throw new Error("Invalid WhatsApp outbound message");
    const response = await fetch(`${this.graphBase}/${this.graphVersion}/${this.phoneNumberId}/messages`, { method: "POST", headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }) });
    if (!response.ok) throw new Error(`WhatsApp send failed (${response.status})`);
    const value = await response.json() as { messages?: Array<{ id?: string }> };
    const id = value.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp did not return a message ID");
    return id;
  }
}
