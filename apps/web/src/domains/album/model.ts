import type { RouteOutput } from "@pokepets/api-contracts";

export type Album = RouteOutput<"album.get">;
export type AlbumChain = Album["chains"][number];
