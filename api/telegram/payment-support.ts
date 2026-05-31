import { loadPaymentSupportConfig } from "../_shared/paymentSupportConfig.js";
import { withApiHandler } from "../_shared/handler.js";

export default withApiHandler(
  async () => {
    const config = await loadPaymentSupportConfig();

    return {
      configured: config.configured,
      supportEmail: config.configured ? config.supportEmail : null,
      supportUrl: config.configured ? config.supportUrl : null,
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "telegram.payment_support",
    },
  },
);
