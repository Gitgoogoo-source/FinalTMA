import type { RouteOutput } from "@pokepets/api-contracts/app";

export type AlbumChain = RouteOutput<"album.get">["chains"][number];
export type AlbumNode = AlbumChain["nodes"][number];
export type AlbumFilter =
  | "all"
  | "normal"
  | "advanced"
  | "top"
  | "claimable"
  | "incomplete";
