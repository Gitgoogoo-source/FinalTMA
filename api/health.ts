import { withApiHandler } from "./_shared/handler";

export default withApiHandler(
  (_req, _res, ctx) => ({
    status: "ok",
    service: "tma-game-api",
    requestId: ctx.requestId,
    timestamp: new Date().toISOString(),
  }),
  {
    methods: ["GET"],
    cors: {
      origins: "*",
      allowCredentials: false,
    },
  },
);
