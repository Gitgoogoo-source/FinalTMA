export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericTable = {
  Row: Record<string, Json>;
  Insert: Record<string, Json | undefined>;
  Update: Record<string, Json | undefined>;
  Relationships: [];
};

type GenericView = {
  Row: Record<string, Json>;
  Relationships: [];
};

type GenericFunction = {
  Args: Record<string, Json | undefined>;
  Returns: Json;
};

type GenericSchema = {
  Tables: Record<string, GenericTable>;
  Views: Record<string, GenericView>;
  Functions: Record<string, GenericFunction>;
  Enums: Record<string, string>;
  CompositeTypes: Record<string, Record<string, Json>>;
};

export type Database = {
  public: GenericSchema;
  core: GenericSchema;
  economy: GenericSchema;
  catalog: GenericSchema;
  gacha: GenericSchema;
  inventory: GenericSchema;
  market: GenericSchema;
  payments: GenericSchema;
  tasks: GenericSchema;
  album: GenericSchema;
  onchain: GenericSchema;
  ops: GenericSchema;
};
