import type { ErrorCode } from "../../common/errors.ts";
import { albumRoutes } from "./routes.ts";

export const albumErrorCodes = [
  ...new Set(albumRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
