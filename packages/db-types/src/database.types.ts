export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  album: {
    Tables: {
      book_items: {
        Row: {
          book_id: string
          created_at: string
          sort_order: number
          template_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          sort_order?: number
          template_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_items_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          active: boolean
          book_type: string
          code: string
          cover_url: string | null
          created_at: string
          description: string | null
          display_name: string
          ends_at: string | null
          faction_id: string | null
          id: string
          metadata: Json
          rarity_code: string | null
          series_id: string | null
          sort_order: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          book_type: string
          code: string
          cover_url?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          ends_at?: string | null
          faction_id?: string | null
          id?: string
          metadata?: Json
          rarity_code?: string | null
          series_id?: string | null
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          book_type?: string
          code?: string
          cover_url?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          ends_at?: string | null
          faction_id?: string | null
          id?: string
          metadata?: Json
          rarity_code?: string | null
          series_id?: string | null
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      leaderboard_entries: {
        Row: {
          calculated_at: string
          collected_count: number
          completion_percent: number
          epic_count: number
          id: string
          leaderboard_id: string
          legendary_count: number
          metadata: Json
          minted_count: number
          rank: number | null
          rare_count: number
          score: number
          total_count: number
          user_id: string
        }
        Insert: {
          calculated_at?: string
          collected_count?: number
          completion_percent?: number
          epic_count?: number
          id?: string
          leaderboard_id: string
          legendary_count?: number
          metadata?: Json
          minted_count?: number
          rank?: number | null
          rare_count?: number
          score?: number
          total_count?: number
          user_id: string
        }
        Update: {
          calculated_at?: string
          collected_count?: number
          completion_percent?: number
          epic_count?: number
          id?: string
          leaderboard_id?: string
          legendary_count?: number
          metadata?: Json
          minted_count?: number
          rank?: number | null
          rare_count?: number
          score?: number
          total_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_entries_leaderboard_id_fkey"
            columns: ["leaderboard_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboards"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_claims: {
        Row: {
          claimed_at: string
          id: string
          metadata: Json
          milestone_id: string
          reward: Json
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          metadata?: Json
          milestone_id: string
          reward?: Json
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          metadata?: Json
          milestone_id?: string
          reward?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_claims_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          active: boolean
          book_id: string
          created_at: string
          id: string
          metadata: Json
          required_count: number
          reward: Json
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          book_id: string
          created_at?: string
          id?: string
          metadata?: Json
          required_count: number
          reward?: Json
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          book_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          required_count?: number
          reward?: Json
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      score_rules: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          metadata: Json
          points: number
          rarity_code: string | null
          rule_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          metadata?: Json
          points?: number
          rarity_code?: string | null
          rule_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          metadata?: Json
          points?: number
          rarity_code?: string | null
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_discoveries: {
        Row: {
          discovered_at: string
          first_item_instance_id: string | null
          first_source_id: string | null
          first_source_type: string | null
          id: string
          metadata: Json
          template_id: string
          user_id: string
        }
        Insert: {
          discovered_at?: string
          first_item_instance_id?: string | null
          first_source_id?: string | null
          first_source_type?: string | null
          id?: string
          metadata?: Json
          template_id: string
          user_id: string
        }
        Update: {
          discovered_at?: string
          first_item_instance_id?: string | null
          first_source_id?: string | null
          first_source_type?: string | null
          id?: string
          metadata?: Json
          template_id?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_leaderboards: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          metadata: Json
          settled_at: string | null
          starts_at: string
          status: string
          updated_at: string
          week_key: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          metadata?: Json
          settled_at?: string | null
          starts_at: string
          status?: string
          updated_at?: string
          week_key: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          metadata?: Json
          settled_at?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          week_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  catalog: {
    Tables: {
      banner_campaigns: {
        Row: {
          code: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          image_url: string
          metadata: Json
          placement: string
          sort_order: number
          starts_at: string | null
          status: string
          target_ref: string | null
          target_type: string
          title: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url: string
          metadata?: Json
          placement: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          target_ref?: string | null
          target_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string
          metadata?: Json
          placement?: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          target_ref?: string | null
          target_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      collectible_forms: {
        Row: {
          avatar_url: string | null
          base_power_bonus: number
          created_at: string
          description: string | null
          display_name: string
          form_index: number
          form_slug: string
          id: string
          image_url: string | null
          is_default: boolean
          metadata: Json
          next_form_id: string | null
          template_id: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          base_power_bonus?: number
          created_at?: string
          description?: string | null
          display_name: string
          form_index: number
          form_slug: string
          id?: string
          image_url?: string | null
          is_default?: boolean
          metadata?: Json
          next_form_id?: string | null
          template_id: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          base_power_bonus?: number
          created_at?: string
          description?: string | null
          display_name?: string
          form_index?: number
          form_slug?: string
          id?: string
          image_url?: string | null
          is_default?: boolean
          metadata?: Json
          next_form_id?: string | null
          template_id?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collectible_forms_next_form_id_fkey"
            columns: ["next_form_id"]
            isOneToOne: false
            referencedRelation: "collectible_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectible_forms_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "collectible_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      collectible_media: {
        Row: {
          created_at: string
          form_id: string | null
          height: number | null
          id: string
          media_type: string
          metadata: Json
          mime_type: string | null
          sort_order: number
          storage_bucket: string | null
          storage_path: string | null
          template_id: string
          url: string
          width: number | null
        }
        Insert: {
          created_at?: string
          form_id?: string | null
          height?: number | null
          id?: string
          media_type: string
          metadata?: Json
          mime_type?: string | null
          sort_order?: number
          storage_bucket?: string | null
          storage_path?: string | null
          template_id: string
          url: string
          width?: number | null
        }
        Update: {
          created_at?: string
          form_id?: string | null
          height?: number | null
          id?: string
          media_type?: string
          metadata?: Json
          mime_type?: string | null
          sort_order?: number
          storage_bucket?: string | null
          storage_path?: string | null
          template_id?: string
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collectible_media_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "collectible_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectible_media_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "collectible_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      collectible_templates: {
        Row: {
          base_power: number
          created_at: string
          decomposable: boolean
          description: string | null
          display_name: string
          evolvable: boolean
          faction_id: string | null
          id: string
          max_level: number
          metadata: Json
          nft_mintable: boolean
          rarity_code: string
          release_status: string
          series_id: string | null
          slug: string
          sort_order: number
          subtitle: string | null
          supply_limit: number | null
          tradeable: boolean
          type_code: string
          updated_at: string
          upgradeable: boolean
        }
        Insert: {
          base_power?: number
          created_at?: string
          decomposable?: boolean
          description?: string | null
          display_name: string
          evolvable?: boolean
          faction_id?: string | null
          id?: string
          max_level?: number
          metadata?: Json
          nft_mintable?: boolean
          rarity_code: string
          release_status?: string
          series_id?: string | null
          slug: string
          sort_order?: number
          subtitle?: string | null
          supply_limit?: number | null
          tradeable?: boolean
          type_code: string
          updated_at?: string
          upgradeable?: boolean
        }
        Update: {
          base_power?: number
          created_at?: string
          decomposable?: boolean
          description?: string | null
          display_name?: string
          evolvable?: boolean
          faction_id?: string | null
          id?: string
          max_level?: number
          metadata?: Json
          nft_mintable?: boolean
          rarity_code?: string
          release_status?: string
          series_id?: string | null
          slug?: string
          sort_order?: number
          subtitle?: string | null
          supply_limit?: number | null
          tradeable?: boolean
          type_code?: string
          updated_at?: string
          upgradeable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "collectible_templates_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectible_templates_rarity_code_fkey"
            columns: ["rarity_code"]
            isOneToOne: false
            referencedRelation: "rarities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collectible_templates_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectible_templates_type_code_fkey"
            columns: ["type_code"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["code"]
          },
        ]
      }
      factions: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          icon_url: string | null
          id: string
          metadata: Json
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          icon_url?: string | null
          id?: string
          metadata?: Json
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          icon_url?: string | null
          id?: string
          metadata?: Json
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      item_tags: {
        Row: {
          code: string
          created_at: string
          display_name: string
          id: string
          metadata: Json
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          id?: string
          metadata?: Json
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      item_types: {
        Row: {
          code: string
          created_at: string
          display_name: string
          metadata: Json
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          metadata?: Json
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          metadata?: Json
          sort_order?: number
        }
        Relationships: []
      }
      market_price_rules: {
        Row: {
          active: boolean
          created_at: string
          form_index: number | null
          id: string
          max_price_kcoin: number | null
          metadata: Json
          min_price_kcoin: number
          rarity_code: string | null
          suggested_price_kcoin: number | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          form_index?: number | null
          id?: string
          max_price_kcoin?: number | null
          metadata?: Json
          min_price_kcoin?: number
          rarity_code?: string | null
          suggested_price_kcoin?: number | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          form_index?: number | null
          id?: string
          max_price_kcoin?: number | null
          metadata?: Json
          min_price_kcoin?: number
          rarity_code?: string | null
          suggested_price_kcoin?: number | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_price_rules_rarity_code_fkey"
            columns: ["rarity_code"]
            isOneToOne: false
            referencedRelation: "rarities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "market_price_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "collectible_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      power_rules: {
        Row: {
          active: boolean
          base_power_multiplier: number
          created_at: string
          form_index: number
          id: string
          level_max: number
          level_min: number
          level_power_step: number
          metadata: Json
          rarity_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_power_multiplier?: number
          created_at?: string
          form_index?: number
          id?: string
          level_max?: number
          level_min?: number
          level_power_step?: number
          metadata?: Json
          rarity_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_power_multiplier?: number
          created_at?: string
          form_index?: number
          id?: string
          level_max?: number
          level_min?: number
          level_power_step?: number
          metadata?: Json
          rarity_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "power_rules_rarity_code_fkey"
            columns: ["rarity_code"]
            isOneToOne: false
            referencedRelation: "rarities"
            referencedColumns: ["code"]
          },
        ]
      }
      rarities: {
        Row: {
          code: string
          color_token: string | null
          created_at: string
          default_decompose_fgems: number
          display_name: string
          label_bg_token: string | null
          metadata: Json
          min_power: number
          pity_eligible: boolean
          sort_order: number
        }
        Insert: {
          code: string
          color_token?: string | null
          created_at?: string
          default_decompose_fgems?: number
          display_name: string
          label_bg_token?: string | null
          metadata?: Json
          min_power?: number
          pity_eligible?: boolean
          sort_order: number
        }
        Update: {
          code?: string
          color_token?: string | null
          created_at?: string
          default_decompose_fgems?: number
          display_name?: string
          label_bg_token?: string | null
          metadata?: Json
          min_power?: number
          pity_eligible?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      series: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          display_name: string
          ends_at: string | null
          id: string
          metadata: Json
          slug: string
          sort_order: number
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          slug: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          slug?: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      template_tags: {
        Row: {
          created_at: string
          tag_id: string
          template_id: string
        }
        Insert: {
          created_at?: string
          tag_id: string
          template_id: string
        }
        Update: {
          created_at?: string
          tag_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "item_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_tags_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "collectible_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  core: {
    Tables: {
      app_sessions: {
        Row: {
          created_at: string
          device_id: string | null
          expires_at: string
          id: string
          init_data_hash: string | null
          ip_hash: string | null
          last_seen_at: string | null
          platform: string | null
          revoked_at: string | null
          session_token_hash: string
          telegram_auth_date: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          expires_at: string
          id?: string
          init_data_hash?: string | null
          ip_hash?: string | null
          last_seen_at?: string | null
          platform?: string | null
          revoked_at?: string | null
          session_token_hash: string
          telegram_auth_date?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          expires_at?: string
          id?: string
          init_data_hash?: string | null
          ip_hash?: string | null
          last_seen_at?: string | null
          platform?: string | null
          revoked_at?: string | null
          session_token_hash?: string
          telegram_auth_date?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          notification_type: string
          payload: Json
          read_at: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          notification_type: string
          payload?: Json
          read_at?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          notification_type?: string
          payload?: Json
          read_at?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          token_hash: string
          token_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          token_hash: string
          token_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
          token_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_devices: {
        Row: {
          device_key: string
          first_seen_at: string
          id: string
          last_seen_at: string | null
          metadata: Json
          platform: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          device_key: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string | null
          metadata?: Json
          platform?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          device_key?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string | null
          metadata?: Json
          platform?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_flags: {
        Row: {
          active: boolean
          created_at: string
          created_by_admin_id: string | null
          ends_at: string | null
          flag_code: string
          flag_level: string
          id: string
          metadata: Json
          reason: string | null
          starts_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by_admin_id?: string | null
          ends_at?: string | null
          flag_code: string
          flag_level?: string
          id?: string
          metadata?: Json
          reason?: string | null
          starts_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by_admin_id?: string | null
          ends_at?: string | null
          flag_code?: string
          flag_level?: string
          id?: string
          metadata?: Json
          reason?: string | null
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          selected_item_instance_id: string | null
          selected_language: string | null
          timezone: string | null
          ui_settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          selected_item_instance_id?: string | null
          selected_language?: string | null
          timezone?: string | null
          ui_settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          selected_item_instance_id?: string | null
          selected_language?: string | null
          timezone?: string | null
          ui_settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wallets: {
        Row: {
          address: string
          address_raw: string | null
          chain: string
          created_at: string
          disconnected_at: string | null
          id: string
          is_primary: boolean
          last_sync_at: string | null
          metadata: Json
          network: string
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
          wallet_app_name: string | null
          wallet_device: string | null
        }
        Insert: {
          address: string
          address_raw?: string | null
          chain?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_primary?: boolean
          last_sync_at?: string | null
          metadata?: Json
          network?: string
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
          wallet_app_name?: string | null
          wallet_device?: string | null
        }
        Update: {
          address?: string
          address_raw?: string | null
          chain?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_primary?: boolean
          last_sync_at?: string | null
          metadata?: Json
          network?: string
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          wallet_app_name?: string | null
          wallet_device?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          first_name: string | null
          first_seen_at: string
          id: string
          invite_code: string
          is_bot: boolean
          is_premium: boolean
          language_code: string | null
          last_auth_at: string | null
          last_name: string | null
          last_seen_at: string | null
          metadata: Json
          photo_url: string | null
          referred_by_user_id: string | null
          risk_score: number
          status: string
          telegram_user_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          first_seen_at?: string
          id?: string
          invite_code?: string
          is_bot?: boolean
          is_premium?: boolean
          language_code?: string | null
          last_auth_at?: string | null
          last_name?: string | null
          last_seen_at?: string | null
          metadata?: Json
          photo_url?: string | null
          referred_by_user_id?: string | null
          risk_score?: number
          status?: string
          telegram_user_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          first_name?: string | null
          first_seen_at?: string
          id?: string
          invite_code?: string
          is_bot?: boolean
          is_premium?: boolean
          language_code?: string | null
          last_auth_at?: string | null
          last_name?: string | null
          last_seen_at?: string | null
          metadata?: Json
          photo_url?: string | null
          referred_by_user_id?: string | null
          risk_score?: number
          status?: string
          telegram_user_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_proofs: {
        Row: {
          address: string | null
          challenge: string
          created_at: string
          domain: string | null
          error_message: string | null
          expires_at: string
          id: string
          payload: Json
          proof_signature: string | null
          status: string
          user_id: string
          verified_at: string | null
          wallet_id: string | null
        }
        Insert: {
          address?: string | null
          challenge: string
          created_at?: string
          domain?: string | null
          error_message?: string | null
          expires_at: string
          id?: string
          payload?: Json
          proof_signature?: string | null
          status?: string
          user_id: string
          verified_at?: string | null
          wallet_id?: string | null
        }
        Update: {
          address?: string | null
          challenge?: string
          created_at?: string
          domain?: string | null
          error_message?: string | null
          expires_at?: string
          id?: string
          payload?: Json
          proof_signature?: string | null
          status?: string
          user_id?: string
          verified_at?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_proofs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_proofs_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "user_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_admin_id: { Args: never; Returns: string }
      current_user_id: { Args: never; Returns: string }
      request_claims: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  economy: {
    Tables: {
      balance_locks: {
        Row: {
          amount: number
          consumed_at: string | null
          created_at: string
          currency_code: string
          expires_at: string | null
          id: string
          lock_type: string
          metadata: Json
          released_at: string | null
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          consumed_at?: string | null
          created_at?: string
          currency_code: string
          expires_at?: string | null
          id?: string
          lock_type: string
          metadata?: Json
          released_at?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          consumed_at?: string | null
          created_at?: string
          currency_code?: string
          expires_at?: string | null
          id?: string
          lock_type?: string
          metadata?: Json
          released_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_locks_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          currency_type: string
          decimals: number
          display_name: string
          is_spendable: boolean
          is_transferable: boolean
          metadata: Json
          symbol: string | null
        }
        Insert: {
          code: string
          created_at?: string
          currency_type?: string
          decimals?: number
          display_name: string
          is_spendable?: boolean
          is_transferable?: boolean
          metadata?: Json
          symbol?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          currency_type?: string
          decimals?: number
          display_name?: string
          is_spendable?: boolean
          is_transferable?: boolean
          metadata?: Json
          symbol?: string | null
        }
        Relationships: []
      }
      currency_ledger: {
        Row: {
          amount: number
          available_after: number | null
          available_before: number | null
          created_at: string
          currency_code: string
          entry_type: string
          id: string
          idempotency_key: string | null
          locked_after: number | null
          locked_before: number | null
          metadata: Json
          note: string | null
          source_id: string | null
          source_ref: string | null
          source_type: string
          user_id: string | null
        }
        Insert: {
          amount: number
          available_after?: number | null
          available_before?: number | null
          created_at?: string
          currency_code: string
          entry_type: string
          id?: string
          idempotency_key?: string | null
          locked_after?: number | null
          locked_before?: number | null
          metadata?: Json
          note?: string | null
          source_id?: string | null
          source_ref?: string | null
          source_type: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          available_after?: number | null
          available_before?: number | null
          created_at?: string
          currency_code?: string
          entry_type?: string
          id?: string
          idempotency_key?: string | null
          locked_after?: number | null
          locked_before?: number | null
          metadata?: Json
          note?: string | null
          source_id?: string | null
          source_ref?: string | null
          source_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "currency_ledger_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      fee_rules: {
        Row: {
          active: boolean
          code: string
          created_at: string
          currency_code: string
          ends_at: string | null
          fee_bps: number
          fee_type: string
          id: string
          max_fee: number | null
          metadata: Json
          min_fee: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          currency_code: string
          ends_at?: string | null
          fee_bps?: number
          fee_type: string
          id?: string
          max_fee?: number | null
          metadata?: Json
          min_fee?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          currency_code?: string
          ends_at?: string | null
          fee_bps?: number
          fee_type?: string
          id?: string
          max_fee?: number | null
          metadata?: Json
          min_fee?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_rules_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          created_by: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          result: Json
          run_type: string
          started_at: string
          status: string
        }
        Insert: {
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          run_type: string
          started_at?: string
          status?: string
        }
        Update: {
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          run_type?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      reward_rules: {
        Row: {
          active: boolean
          amount: number
          code: string
          created_at: string
          currency_code: string
          ends_at: string | null
          id: string
          metadata: Json
          reward_type: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount: number
          code: string
          created_at?: string
          currency_code: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          reward_type: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          code?: string
          created_at?: string
          currency_code?: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          reward_type?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_rules_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      user_balances: {
        Row: {
          available_amount: number
          created_at: string
          currency_code: string
          locked_amount: number
          total_earned: number
          total_locked: number
          total_spent: number
          total_unlocked: number
          updated_at: string
          user_id: string
        }
        Insert: {
          available_amount?: number
          created_at?: string
          currency_code: string
          locked_amount?: number
          total_earned?: number
          total_locked?: number
          total_spent?: number
          total_unlocked?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          available_amount?: number
          created_at?: string
          currency_code?: string
          locked_amount?: number
          total_earned?: number
          total_locked?: number
          total_spent?: number
          total_unlocked?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_balances_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  gacha: {
    Tables: {
      blind_boxes: {
        Row: {
          cover_image_url: string | null
          created_at: string
          description: string | null
          display_name: string
          ends_at: string | null
          hero_image_url: string | null
          id: string
          metadata: Json
          open_reward_kcoin: number
          price_stars: number
          remaining_stock: number | null
          slug: string
          sort_order: number
          starts_at: string | null
          status: string
          tier: string
          total_stock: number | null
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          ends_at?: string | null
          hero_image_url?: string | null
          id?: string
          metadata?: Json
          open_reward_kcoin?: number
          price_stars: number
          remaining_stock?: number | null
          slug: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          tier: string
          total_stock?: number | null
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          ends_at?: string | null
          hero_image_url?: string | null
          id?: string
          metadata?: Json
          open_reward_kcoin?: number
          price_stars?: number
          remaining_stock?: number | null
          slug?: string
          sort_order?: number
          starts_at?: string | null
          status?: string
          tier?: string
          total_stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      box_price_rules: {
        Row: {
          active: boolean
          box_id: string
          created_at: string
          discount_bps: number
          ends_at: string | null
          id: string
          metadata: Json
          price_stars_override: number | null
          quantity: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          box_id: string
          created_at?: string
          discount_bps?: number
          ends_at?: string | null
          id?: string
          metadata?: Json
          price_stars_override?: number | null
          quantity: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          box_id?: string
          created_at?: string
          discount_bps?: number
          ends_at?: string | null
          id?: string
          metadata?: Json
          price_stars_override?: number | null
          quantity?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_price_rules_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_audit: {
        Row: {
          created_at: string
          draw_order_id: string
          id: string
          pool_version_id: string
          random_seed_hash: string | null
          request_context: Json
          rules_snapshot: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          draw_order_id: string
          id?: string
          pool_version_id: string
          random_seed_hash?: string | null
          request_context?: Json
          rules_snapshot?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          draw_order_id?: string
          id?: string
          pool_version_id?: string
          random_seed_hash?: string | null
          request_context?: Json
          rules_snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draw_audit_draw_order_id_fkey"
            columns: ["draw_order_id"]
            isOneToOne: false
            referencedRelation: "draw_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_audit_pool_version_id_fkey"
            columns: ["pool_version_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_orders: {
        Row: {
          box_id: string
          created_at: string
          discount_bps: number
          draw_count: number
          error_message: string | null
          id: string
          idempotency_key: string
          invoice_payload: string
          metadata: Json
          open_reward_kcoin: number
          opened_at: string | null
          paid_at: string | null
          payment_provider: string | null
          payment_star_order_id: string | null
          payment_status: string | null
          pool_version_id: string
          quantity: number
          star_amount: number | null
          status: string
          telegram_invoice_payload: string | null
          telegram_payment_charge_id: string | null
          total_price_stars: number
          unit_price_stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          box_id: string
          created_at?: string
          discount_bps?: number
          draw_count: number
          error_message?: string | null
          id?: string
          idempotency_key: string
          invoice_payload: string
          metadata?: Json
          open_reward_kcoin?: number
          opened_at?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_star_order_id?: string | null
          payment_status?: string | null
          pool_version_id: string
          quantity: number
          star_amount?: number | null
          status?: string
          telegram_invoice_payload?: string | null
          telegram_payment_charge_id?: string | null
          total_price_stars: number
          unit_price_stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          box_id?: string
          created_at?: string
          discount_bps?: number
          draw_count?: number
          error_message?: string | null
          id?: string
          idempotency_key?: string
          invoice_payload?: string
          metadata?: Json
          open_reward_kcoin?: number
          opened_at?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_star_order_id?: string | null
          payment_status?: string | null
          pool_version_id?: string
          quantity?: number
          star_amount?: number | null
          status?: string
          telegram_invoice_payload?: string | null
          telegram_payment_charge_id?: string | null
          total_price_stars?: number
          unit_price_stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draw_orders_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_orders_pool_version_id_fkey"
            columns: ["pool_version_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_results: {
        Row: {
          box_id: string
          created_at: string
          draw_index: number
          draw_order_id: string
          drop_pool_item_id: string | null
          form_id: string | null
          id: string
          item_instance_id: string | null
          metadata: Json
          pool_version_id: string
          random_roll: number | null
          rarity_code: string
          template_id: string
          user_id: string
          was_pity: boolean
        }
        Insert: {
          box_id: string
          created_at?: string
          draw_index: number
          draw_order_id: string
          drop_pool_item_id?: string | null
          form_id?: string | null
          id?: string
          item_instance_id?: string | null
          metadata?: Json
          pool_version_id: string
          random_roll?: number | null
          rarity_code: string
          template_id: string
          user_id: string
          was_pity?: boolean
        }
        Update: {
          box_id?: string
          created_at?: string
          draw_index?: number
          draw_order_id?: string
          drop_pool_item_id?: string | null
          form_id?: string | null
          id?: string
          item_instance_id?: string | null
          metadata?: Json
          pool_version_id?: string
          random_roll?: number | null
          rarity_code?: string
          template_id?: string
          user_id?: string
          was_pity?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "draw_results_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_results_draw_order_id_fkey"
            columns: ["draw_order_id"]
            isOneToOne: false
            referencedRelation: "draw_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_results_drop_pool_item_id_fkey"
            columns: ["drop_pool_item_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_results_pool_version_id_fkey"
            columns: ["pool_version_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_pool_items: {
        Row: {
          created_at: string
          drop_weight: number
          form_id: string | null
          id: string
          is_featured: boolean
          is_pity_eligible: boolean
          metadata: Json
          pool_version_id: string
          probability_bps: number | null
          rarity_code: string
          sort_order: number
          stock_remaining: number | null
          stock_total: number | null
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          drop_weight: number
          form_id?: string | null
          id?: string
          is_featured?: boolean
          is_pity_eligible?: boolean
          metadata?: Json
          pool_version_id: string
          probability_bps?: number | null
          rarity_code: string
          sort_order?: number
          stock_remaining?: number | null
          stock_total?: number | null
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          drop_weight?: number
          form_id?: string | null
          id?: string
          is_featured?: boolean
          is_pity_eligible?: boolean
          metadata?: Json
          pool_version_id?: string
          probability_bps?: number | null
          rarity_code?: string
          sort_order?: number
          stock_remaining?: number | null
          stock_total?: number | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drop_pool_items_pool_version_id_fkey"
            columns: ["pool_version_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_pool_versions: {
        Row: {
          box_id: string
          config_snapshot: Json
          created_at: string
          created_by_admin_id: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          published_at: string | null
          status: string
          total_weight: number
          updated_at: string
          version_no: number
        }
        Insert: {
          box_id: string
          config_snapshot?: Json
          created_at?: string
          created_by_admin_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          published_at?: string | null
          status?: string
          total_weight?: number
          updated_at?: string
          version_no: number
        }
        Update: {
          box_id?: string
          config_snapshot?: Json
          created_at?: string
          created_by_admin_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          published_at?: string | null
          status?: string
          total_weight?: number
          updated_at?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "drop_pool_versions_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      pity_rules: {
        Row: {
          active: boolean
          box_id: string
          created_at: string
          guaranteed_form_id: string | null
          guaranteed_template_id: string | null
          id: string
          metadata: Json
          pool_version_id: string | null
          priority: number
          reset_on_rarity_code: string | null
          rule_name: string
          target_rarity_code: string
          threshold: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          box_id: string
          created_at?: string
          guaranteed_form_id?: string | null
          guaranteed_template_id?: string | null
          id?: string
          metadata?: Json
          pool_version_id?: string | null
          priority?: number
          reset_on_rarity_code?: string | null
          rule_name: string
          target_rarity_code: string
          threshold: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          box_id?: string
          created_at?: string
          guaranteed_form_id?: string | null
          guaranteed_template_id?: string | null
          id?: string
          metadata?: Json
          pool_version_id?: string | null
          priority?: number
          reset_on_rarity_code?: string | null
          rule_name?: string
          target_rarity_code?: string
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pity_rules_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pity_rules_pool_version_id_fkey"
            columns: ["pool_version_id"]
            isOneToOne: false
            referencedRelation: "drop_pool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pity_states: {
        Row: {
          box_id: string
          created_at: string
          current_count: number
          last_hit_at: string | null
          pity_rule_id: string
          total_draws: number
          updated_at: string
          user_id: string
        }
        Insert: {
          box_id: string
          created_at?: string
          current_count?: number
          last_hit_at?: string | null
          pity_rule_id: string
          total_draws?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          box_id?: string
          created_at?: string
          current_count?: number
          last_hit_at?: string | null
          pity_rule_id?: string
          total_draws?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pity_states_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "blind_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_pity_states_pity_rule_id_fkey"
            columns: ["pity_rule_id"]
            isOneToOne: false
            referencedRelation: "pity_rules"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  inventory: {
    Tables: {
      decompose_logs: {
        Row: {
          created_at: string
          id: string
          item_instance_id: string
          ledger_id: string | null
          reward_fgems: number
          rule_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_instance_id: string
          ledger_id?: string | null
          reward_fgems: number
          rule_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_instance_id?: string
          ledger_id?: string | null
          reward_fgems?: number
          rule_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decompose_logs_item_instance_id_fkey"
            columns: ["item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decompose_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "decompose_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      decompose_rules: {
        Row: {
          active: boolean
          created_at: string
          form_index: number
          id: string
          metadata: Json
          min_level: number
          rarity_code: string
          reward_fgems: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          form_index?: number
          id?: string
          metadata?: Json
          min_level?: number
          rarity_code: string
          reward_fgems: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          form_index?: number
          id?: string
          metadata?: Json
          min_level?: number
          rarity_code?: string
          reward_fgems?: number
          updated_at?: string
        }
        Relationships: []
      }
      evolution_attempts: {
        Row: {
          cost_kcoin: number
          created_at: string
          id: string
          ledger_id: string | null
          main_item_instance_id: string | null
          metadata: Json
          random_roll_bps: number
          result_item_instance_id: string | null
          rule_id: string | null
          status: string
          success_rate_bps: number
          user_id: string
        }
        Insert: {
          cost_kcoin?: number
          created_at?: string
          id?: string
          ledger_id?: string | null
          main_item_instance_id?: string | null
          metadata?: Json
          random_roll_bps: number
          result_item_instance_id?: string | null
          rule_id?: string | null
          status: string
          success_rate_bps: number
          user_id: string
        }
        Update: {
          cost_kcoin?: number
          created_at?: string
          id?: string
          ledger_id?: string | null
          main_item_instance_id?: string | null
          metadata?: Json
          random_roll_bps?: number
          result_item_instance_id?: string | null
          rule_id?: string | null
          status?: string
          success_rate_bps?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_attempts_main_item_instance_id_fkey"
            columns: ["main_item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_attempts_result_item_instance_id_fkey"
            columns: ["result_item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_attempts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "evolution_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_consumed_items: {
        Row: {
          attempt_id: string
          consumed: boolean
          created_at: string
          item_instance_id: string
          returned: boolean
          role: string
        }
        Insert: {
          attempt_id: string
          consumed?: boolean
          created_at?: string
          item_instance_id: string
          returned?: boolean
          role: string
        }
        Update: {
          attempt_id?: string
          consumed?: boolean
          created_at?: string
          item_instance_id?: string
          returned?: boolean
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_consumed_items_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "evolution_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_consumed_items_item_instance_id_fkey"
            columns: ["item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_rules: {
        Row: {
          active: boolean
          cost_kcoin: number
          created_at: string
          from_form_id: string
          from_template_id: string
          id: string
          metadata: Json
          required_count: number
          success_rate_bps: number
          to_form_id: string
          to_template_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_kcoin?: number
          created_at?: string
          from_form_id: string
          from_template_id: string
          id?: string
          metadata?: Json
          required_count?: number
          success_rate_bps?: number
          to_form_id: string
          to_template_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_kcoin?: number
          created_at?: string
          from_form_id?: string
          from_template_id?: string
          id?: string
          metadata?: Json
          required_count?: number
          success_rate_bps?: number
          to_form_id?: string
          to_template_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_locks: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          item_instance_id: string
          lock_type: string
          locked_at: string
          metadata: Json
          released_at: string | null
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          item_instance_id: string
          lock_type: string
          locked_at?: string
          metadata?: Json
          released_at?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          item_instance_id?: string
          lock_type?: string
          locked_at?: string
          metadata?: Json
          released_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locks_item_instance_id_fkey"
            columns: ["item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      item_instance_events: {
        Row: {
          after_state: Json
          before_state: Json
          created_at: string
          event_type: string
          id: string
          item_instance_id: string
          metadata: Json
          source_id: string | null
          source_type: string | null
          user_id: string | null
        }
        Insert: {
          after_state?: Json
          before_state?: Json
          created_at?: string
          event_type: string
          id?: string
          item_instance_id: string
          metadata?: Json
          source_id?: string | null
          source_type?: string | null
          user_id?: string | null
        }
        Update: {
          after_state?: Json
          before_state?: Json
          created_at?: string
          event_type?: string
          id?: string
          item_instance_id?: string
          metadata?: Json
          source_id?: string | null
          source_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_instance_events_item_instance_id_fkey"
            columns: ["item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      item_instances: {
        Row: {
          acquired_at: string
          created_at: string
          exp: number
          form_id: string | null
          id: string
          level: number
          lock_version: number
          metadata: Json
          minted_nft_item_id: string | null
          nft_mint_status: string
          owner_user_id: string | null
          power: number
          serial_no: number
          source_id: string | null
          source_type: string
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          acquired_at?: string
          created_at?: string
          exp?: number
          form_id?: string | null
          id?: string
          level?: number
          lock_version?: number
          metadata?: Json
          minted_nft_item_id?: string | null
          nft_mint_status?: string
          owner_user_id?: string | null
          power?: number
          serial_no?: never
          source_id?: string | null
          source_type?: string
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          acquired_at?: string
          created_at?: string
          exp?: number
          form_id?: string | null
          id?: string
          level?: number
          lock_version?: number
          metadata?: Json
          minted_nft_item_id?: string | null
          nft_mint_status?: string
          owner_user_id?: string | null
          power?: number
          serial_no?: never
          source_id?: string | null
          source_type?: string
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      upgrade_logs: {
        Row: {
          cost_fgems: number
          created_at: string
          from_level: number
          from_power: number
          id: string
          item_instance_id: string
          ledger_id: string | null
          rule_id: string | null
          to_level: number
          to_power: number
          user_id: string
        }
        Insert: {
          cost_fgems?: number
          created_at?: string
          from_level: number
          from_power: number
          id?: string
          item_instance_id: string
          ledger_id?: string | null
          rule_id?: string | null
          to_level: number
          to_power: number
          user_id: string
        }
        Update: {
          cost_fgems?: number
          created_at?: string
          from_level?: number
          from_power?: number
          id?: string
          item_instance_id?: string
          ledger_id?: string | null
          rule_id?: string | null
          to_level?: number
          to_power?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upgrade_logs_item_instance_id_fkey"
            columns: ["item_instance_id"]
            isOneToOne: false
            referencedRelation: "item_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upgrade_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "upgrade_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      upgrade_rules: {
        Row: {
          active: boolean
          cost_fgems: number
          created_at: string
          form_index: number
          from_level: number
          id: string
          metadata: Json
          power_gain: number
          rarity_code: string
          to_level: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_fgems: number
          created_at?: string
          form_index?: number
          from_level: number
          id?: string
          metadata?: Json
          power_gain?: number
          rarity_code: string
          to_level: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_fgems?: number
          created_at?: string
          form_index?: number
          from_level?: number
          id?: string
          metadata?: Json
          power_gain?: number
          rarity_code?: string
          to_level?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  market: {
    Tables: {
      depth_snapshots: {
        Row: {
          form_id: string | null
          id: string
          item_count: number
          listing_count: number
          price_bucket_kcoin: number
          snapshot_at: string
          template_id: string
        }
        Insert: {
          form_id?: string | null
          id?: string
          item_count?: number
          listing_count?: number
          price_bucket_kcoin: number
          snapshot_at?: string
          template_id: string
        }
        Update: {
          form_id?: string | null
          id?: string
          item_count?: number
          listing_count?: number
          price_bucket_kcoin?: number
          snapshot_at?: string
          template_id?: string
        }
        Relationships: []
      }
      fee_settlements: {
        Row: {
          created_at: string
          currency_code: string
          fee_amount: number
          fee_bps: number
          id: string
          market_order_id: string
          metadata: Json
          settled_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          currency_code: string
          fee_amount: number
          fee_bps?: number
          id?: string
          market_order_id: string
          metadata?: Json
          settled_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          fee_amount?: number
          fee_bps?: number
          id?: string
          market_order_id?: string
          metadata?: Json
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_settlements_market_order_id_fkey"
            columns: ["market_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_events: {
        Row: {
          after_state: Json
          before_state: Json
          created_at: string
          event_type: string
          id: string
          listing_id: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          after_state?: Json
          before_state?: Json
          created_at?: string
          event_type: string
          id?: string
          listing_id: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          after_state?: Json
          before_state?: Json
          created_at?: string
          event_type?: string
          id?: string
          listing_id?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_items: {
        Row: {
          buyer_user_id: string | null
          created_at: string
          id: string
          item_instance_id: string
          listing_id: string
          sold_at: string | null
          sold_order_id: string | null
          status: string
        }
        Insert: {
          buyer_user_id?: string | null
          created_at?: string
          id?: string
          item_instance_id: string
          listing_id: string
          sold_at?: string | null
          sold_order_id?: string | null
          status?: string
        }
        Update: {
          buyer_user_id?: string | null
          created_at?: string
          id?: string
          item_instance_id?: string
          listing_id?: string
          sold_at?: string | null
          sold_order_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_items_sold_order_fk"
            columns: ["sold_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          created_at: string
          expected_net_amount: number
          expires_at: string | null
          fee_bps: number
          form_id: string | null
          id: string
          item_count: number
          last_price_changed_at: string | null
          metadata: Json
          price_health: string | null
          rarity_code: string
          remaining_count: number
          seller_user_id: string
          status: string
          template_id: string
          unit_price_kcoin: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          expected_net_amount?: number
          expires_at?: string | null
          fee_bps?: number
          form_id?: string | null
          id?: string
          item_count: number
          last_price_changed_at?: string | null
          metadata?: Json
          price_health?: string | null
          rarity_code: string
          remaining_count: number
          seller_user_id: string
          status?: string
          template_id: string
          unit_price_kcoin: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          expected_net_amount?: number
          expires_at?: string | null
          fee_bps?: number
          form_id?: string | null
          id?: string
          item_count?: number
          last_price_changed_at?: string | null
          metadata?: Json
          price_health?: string | null
          rarity_code?: string
          remaining_count?: number
          seller_user_id?: string
          status?: string
          template_id?: string
          unit_price_kcoin?: number
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          item_instance_id: string
          listing_item_id: string
          order_id: string
        }
        Insert: {
          created_at?: string
          item_instance_id: string
          listing_item_id: string
          order_id: string
        }
        Update: {
          created_at?: string
          item_instance_id?: string
          listing_item_id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_listing_item_id_fkey"
            columns: ["listing_item_id"]
            isOneToOne: false
            referencedRelation: "listing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_ledger_id: string | null
          buyer_user_id: string
          completed_at: string | null
          created_at: string
          fee_amount_kcoin: number
          fee_bps: number
          id: string
          idempotency_key: string
          item_count: number
          listing_id: string
          metadata: Json
          seller_ledger_id: string | null
          seller_net_amount_kcoin: number
          seller_user_id: string
          status: string
          total_price_kcoin: number
          unit_price_kcoin: number
          updated_at: string
        }
        Insert: {
          buyer_ledger_id?: string | null
          buyer_user_id: string
          completed_at?: string | null
          created_at?: string
          fee_amount_kcoin?: number
          fee_bps?: number
          id?: string
          idempotency_key: string
          item_count: number
          listing_id: string
          metadata?: Json
          seller_ledger_id?: string | null
          seller_net_amount_kcoin?: number
          seller_user_id: string
          status?: string
          total_price_kcoin: number
          unit_price_kcoin: number
          updated_at?: string
        }
        Update: {
          buyer_ledger_id?: string | null
          buyer_user_id?: string
          completed_at?: string | null
          created_at?: string
          fee_amount_kcoin?: number
          fee_bps?: number
          id?: string
          idempotency_key?: string
          item_count?: number
          listing_id?: string
          metadata?: Json
          seller_ledger_id?: string | null
          seller_net_amount_kcoin?: number
          seller_user_id?: string
          status?: string
          total_price_kcoin?: number
          unit_price_kcoin?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      price_health_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_ratio_to_floor: number
          metadata: Json
          min_ratio_to_floor: number
          rarity_code: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_ratio_to_floor?: number
          metadata?: Json
          min_ratio_to_floor?: number
          rarity_code?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_ratio_to_floor?: number
          metadata?: Json
          min_ratio_to_floor?: number
          rarity_code?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      price_snapshots: {
        Row: {
          active_listing_count: number
          avg_price_kcoin: number | null
          floor_price_kcoin: number | null
          form_id: string | null
          id: string
          last_sale_price_kcoin: number | null
          metadata: Json
          rarity_code: string | null
          sale_count_24h: number
          snapshot_at: string
          template_id: string
          volume_24h_kcoin: number
        }
        Insert: {
          active_listing_count?: number
          avg_price_kcoin?: number | null
          floor_price_kcoin?: number | null
          form_id?: string | null
          id?: string
          last_sale_price_kcoin?: number | null
          metadata?: Json
          rarity_code?: string | null
          sale_count_24h?: number
          snapshot_at?: string
          template_id: string
          volume_24h_kcoin?: number
        }
        Update: {
          active_listing_count?: number
          avg_price_kcoin?: number | null
          floor_price_kcoin?: number | null
          form_id?: string | null
          id?: string
          last_sale_price_kcoin?: number | null
          metadata?: Json
          rarity_code?: string | null
          sale_count_24h?: number
          snapshot_at?: string
          template_id?: string
          volume_24h_kcoin?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  onchain: {
    Tables: {
      mint_queue: {
        Row: {
          attempt_count: number
          collection_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          form_id: string | null
          id: string
          idempotency_key: string
          item_instance_id: string
          max_attempts: number
          metadata: Json
          next_attempt_at: string | null
          nft_item_id: string | null
          priority: number
          status: string
          template_id: string
          tx_hash: string | null
          updated_at: string
          user_id: string
          wallet_id: string | null
        }
        Insert: {
          attempt_count?: number
          collection_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          form_id?: string | null
          id?: string
          idempotency_key: string
          item_instance_id: string
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          nft_item_id?: string | null
          priority?: number
          status?: string
          template_id: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
          wallet_id?: string | null
        }
        Update: {
          attempt_count?: number
          collection_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          form_id?: string | null
          id?: string
          idempotency_key?: string
          item_instance_id?: string
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          nft_item_id?: string | null
          priority?: number
          status?: string
          template_id?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mint_queue_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "nft_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mint_queue_nft_item_id_fkey"
            columns: ["nft_item_id"]
            isOneToOne: false
            referencedRelation: "nft_items"
            referencedColumns: ["id"]
          },
        ]
      }
      nft_collections: {
        Row: {
          chain: string
          code: string
          collection_address: string
          content_base_url: string | null
          contract_version: string | null
          created_at: string
          deployed_at: string | null
          id: string
          metadata: Json
          metadata_url: string | null
          network: string
          owner_address: string | null
          royalty_config: Json
          standard: string
          status: string
          updated_at: string
        }
        Insert: {
          chain?: string
          code: string
          collection_address: string
          content_base_url?: string | null
          contract_version?: string | null
          created_at?: string
          deployed_at?: string | null
          id?: string
          metadata?: Json
          metadata_url?: string | null
          network?: string
          owner_address?: string | null
          royalty_config?: Json
          standard?: string
          status?: string
          updated_at?: string
        }
        Update: {
          chain?: string
          code?: string
          collection_address?: string
          content_base_url?: string | null
          contract_version?: string | null
          created_at?: string
          deployed_at?: string | null
          id?: string
          metadata?: Json
          metadata_url?: string | null
          network?: string
          owner_address?: string | null
          royalty_config?: Json
          standard?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      nft_items: {
        Row: {
          collection_id: string
          created_at: string
          form_id: string | null
          id: string
          item_address: string | null
          item_index: number | null
          item_instance_id: string | null
          last_seen_at: string | null
          metadata: Json
          metadata_url: string | null
          minted_at: string | null
          minted_tx_hash: string | null
          owner_address: string | null
          owner_user_id: string | null
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          form_id?: string | null
          id?: string
          item_address?: string | null
          item_index?: number | null
          item_instance_id?: string | null
          last_seen_at?: string | null
          metadata?: Json
          metadata_url?: string | null
          minted_at?: string | null
          minted_tx_hash?: string | null
          owner_address?: string | null
          owner_user_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          form_id?: string | null
          id?: string
          item_address?: string | null
          item_index?: number | null
          item_instance_id?: string | null
          last_seen_at?: string | null
          metadata?: Json
          metadata_url?: string | null
          minted_at?: string | null
          minted_tx_hash?: string | null
          owner_address?: string | null
          owner_user_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nft_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "nft_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_nano: number | null
          chain: string
          confirmed_at: string | null
          created_at: string
          direction: string | null
          error_message: string | null
          id: string
          network: string
          payload: Json
          query_id: string | null
          related_id: string | null
          related_type: string | null
          status: string
          submitted_at: string | null
          tx_hash: string | null
          updated_at: string
          user_id: string | null
          wallet_id: string | null
        }
        Insert: {
          amount_nano?: number | null
          chain?: string
          confirmed_at?: string | null
          created_at?: string
          direction?: string | null
          error_message?: string | null
          id?: string
          network?: string
          payload?: Json
          query_id?: string | null
          related_id?: string | null
          related_type?: string | null
          status?: string
          submitted_at?: string | null
          tx_hash?: string | null
          updated_at?: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          amount_nano?: number | null
          chain?: string
          confirmed_at?: string | null
          created_at?: string
          direction?: string | null
          error_message?: string | null
          id?: string
          network?: string
          payload?: Json
          query_id?: string | null
          related_id?: string | null
          related_type?: string | null
          status?: string
          submitted_at?: string | null
          tx_hash?: string | null
          updated_at?: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Relationships: []
      }
      wallet_nft_snapshots: {
        Row: {
          collection_address: string | null
          created_at: string
          id: string
          item_address: string
          metadata_url: string | null
          owner_address: string
          raw_payload: Json
          seen_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          collection_address?: string | null
          created_at?: string
          id?: string
          item_address: string
          metadata_url?: string | null
          owner_address: string
          raw_payload?: Json
          seen_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          collection_address?: string | null
          created_at?: string
          id?: string
          item_address?: string
          metadata_url?: string | null
          owner_address?: string
          raw_payload?: Json
          seen_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: []
      }
      wallet_sync_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          result: Json
          started_at: string | null
          status: string
          sync_type: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          started_at?: string | null
          status?: string
          sync_type?: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          started_at?: string | null
          status?: string
          sync_type?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  ops: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_user_id: string | null
          after_state: Json
          before_state: Json
          created_at: string
          id: string
          ip_hash: string | null
          reason: string | null
          target_id: string | null
          target_schema: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          after_state?: Json
          before_state?: Json
          created_at?: string
          id?: string
          ip_hash?: string | null
          reason?: string | null
          target_id?: string | null
          target_schema?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          after_state?: Json
          before_state?: Json
          created_at?: string
          id?: string
          ip_hash?: string | null
          reason?: string | null
          target_id?: string | null
          target_schema?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          code: string
          created_at: string
          display_name: string
          id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          id?: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      admin_user_roles: {
        Row: {
          admin_user_id: string
          granted_at: string
          granted_by_admin_id: string | null
          role_id: string
        }
        Insert: {
          admin_user_id: string
          granted_at?: string
          granted_by_admin_id?: string | null
          role_id: string
        }
        Update: {
          admin_user_id?: string
          granted_at?: string
          granted_by_admin_id?: string | null
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_user_roles_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_roles_granted_by_admin_id_fkey"
            columns: ["granted_by_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          core_user_id: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          last_login_at: string | null
          metadata: Json
          status: string
          telegram_user_id: number | null
          updated_at: string
        }
        Insert: {
          core_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          metadata?: Json
          status?: string
          telegram_user_id?: number | null
          updated_at?: string
        }
        Update: {
          core_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          metadata?: Json
          status?: string
          telegram_user_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          blocked_until: string | null
          created_at: string
          id: string
          metadata: Json
          request_count: number
          scope: string
          subject_key: string
          updated_at: string
          window_key: string
        }
        Insert: {
          blocked_until?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_count?: number
          scope: string
          subject_key: string
          updated_at?: string
          window_key: string
        }
        Update: {
          blocked_until?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_count?: number
          scope?: string
          subject_key?: string
          updated_at?: string
          window_key?: string
        }
        Relationships: []
      }
      app_events: {
        Row: {
          created_at: string
          event_name: string
          event_source: string
          id: string
          payload: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          event_source?: string
          id?: string
          payload?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          event_source?: string
          id?: string
          payload?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          key: string
          rollout: Json
          updated_at: string
          updated_by_admin_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          key: string
          rollout?: Json
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          key?: string
          rollout?: Json
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_admin_id_fkey"
            columns: ["updated_by_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          locked_until: string | null
          request_hash: string | null
          response: Json | null
          scope: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          key: string
          locked_until?: string | null
          request_hash?: string | null
          response?: Json | null
          scope: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          key?: string
          locked_until?: string | null
          request_hash?: string | null
          response?: Json | null
          scope?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      risk_events: {
        Row: {
          created_at: string
          detail: Json
          event_type: string
          id: string
          resolved_at: string | null
          resolved_by_admin_id: string | null
          score_delta: number
          severity: string
          source_id: string | null
          source_type: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          resolved_at?: string | null
          resolved_by_admin_id?: string | null
          score_delta?: number
          severity?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          resolved_at?: string | null
          resolved_by_admin_id?: string | null
          score_delta?: number
          severity?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_events_resolved_by_admin_id_fkey"
            columns: ["resolved_by_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_admin_id: string | null
          created_at: string
          id: string
          message: string | null
          metadata: Json
          related_id: string | null
          related_type: string | null
          resolved_at: string | null
          status: string
          subject: string
          ticket_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_admin_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          related_id?: string | null
          related_type?: string | null
          resolved_at?: string | null
          status?: string
          subject: string
          ticket_type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_admin_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          related_id?: string | null
          related_type?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string
          ticket_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_admin_id_fkey"
            columns: ["assigned_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string
          description: string | null
          key: string
          updated_at: string
          updated_by_admin_id: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          updated_by_admin_id?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          updated_by_admin_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_admin_id_fkey"
            columns: ["updated_by_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_admin_permission: { Args: { p_permission: string }; Returns: boolean }
      is_active_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  payments: {
    Tables: {
      payment_disputes: {
        Row: {
          created_at: string
          id: string
          message: string | null
          metadata: Json
          resolution: string | null
          resolved_at: string | null
          resolved_by_admin_id: string | null
          star_order_id: string | null
          star_payment_id: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          resolved_by_admin_id?: string | null
          star_order_id?: string | null
          star_payment_id?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          resolved_by_admin_id?: string | null
          star_order_id?: string | null
          star_payment_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_star_order_id_fkey"
            columns: ["star_order_id"]
            isOneToOne: false
            referencedRelation: "star_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_disputes_star_payment_id_fkey"
            columns: ["star_payment_id"]
            isOneToOne: false
            referencedRelation: "star_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      star_invoices: {
        Row: {
          created_at: string
          id: string
          invoice_link: string | null
          payload: string
          raw_request: Json
          raw_response: Json
          star_order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_link?: string | null
          payload: string
          raw_request?: Json
          raw_response?: Json
          star_order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_link?: string | null
          payload?: string
          raw_request?: Json
          raw_response?: Json
          star_order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "star_invoices_star_order_id_fkey"
            columns: ["star_order_id"]
            isOneToOne: false
            referencedRelation: "star_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      star_orders: {
        Row: {
          business_id: string | null
          business_type: string
          created_at: string
          description: string | null
          error_message: string | null
          expires_at: string | null
          fulfilled_at: string | null
          id: string
          idempotency_key: string
          metadata: Json
          paid_at: string | null
          precheckout_at: string | null
          status: string
          telegram_invoice_payload: string
          title: string
          updated_at: string
          user_id: string
          xtr_amount: number
        }
        Insert: {
          business_id?: string | null
          business_type: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          expires_at?: string | null
          fulfilled_at?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          paid_at?: string | null
          precheckout_at?: string | null
          status?: string
          telegram_invoice_payload: string
          title: string
          updated_at?: string
          user_id: string
          xtr_amount: number
        }
        Update: {
          business_id?: string | null
          business_type?: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          expires_at?: string | null
          fulfilled_at?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          paid_at?: string | null
          precheckout_at?: string | null
          status?: string
          telegram_invoice_payload?: string
          title?: string
          updated_at?: string
          user_id?: string
          xtr_amount?: number
        }
        Relationships: []
      }
      star_payments: {
        Row: {
          created_at: string
          currency: string
          id: string
          invoice_payload: string
          metadata: Json
          paid_at: string
          provider_payment_charge_id: string | null
          raw_update: Json
          star_order_id: string
          telegram_payment_charge_id: string
          user_id: string
          xtr_amount: number
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          invoice_payload: string
          metadata?: Json
          paid_at?: string
          provider_payment_charge_id?: string | null
          raw_update?: Json
          star_order_id: string
          telegram_payment_charge_id: string
          user_id: string
          xtr_amount: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          invoice_payload?: string
          metadata?: Json
          paid_at?: string
          provider_payment_charge_id?: string | null
          raw_update?: Json
          star_order_id?: string
          telegram_payment_charge_id?: string
          user_id?: string
          xtr_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "star_payments_star_order_id_fkey"
            columns: ["star_order_id"]
            isOneToOne: false
            referencedRelation: "star_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      star_refunds: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          processed_at: string | null
          raw_response: Json
          reason: string | null
          requested_by_admin_id: string | null
          star_order_id: string
          star_payment_id: string
          status: string
          telegram_payment_charge_id: string
          updated_at: string
          user_id: string
          xtr_amount: number
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          processed_at?: string | null
          raw_response?: Json
          reason?: string | null
          requested_by_admin_id?: string | null
          star_order_id: string
          star_payment_id: string
          status?: string
          telegram_payment_charge_id: string
          updated_at?: string
          user_id: string
          xtr_amount: number
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          processed_at?: string | null
          raw_response?: Json
          reason?: string | null
          requested_by_admin_id?: string | null
          star_order_id?: string
          star_payment_id?: string
          status?: string
          telegram_payment_charge_id?: string
          updated_at?: string
          user_id?: string
          xtr_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "star_refunds_star_order_id_fkey"
            columns: ["star_order_id"]
            isOneToOne: false
            referencedRelation: "star_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "star_refunds_star_payment_id_fkey"
            columns: ["star_payment_id"]
            isOneToOne: false
            referencedRelation: "star_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          invoice_payload: string | null
          payload: Json
          process_status: string
          processed_at: string | null
          telegram_user_id: number | null
          update_id: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          invoice_payload?: string | null
          payload: Json
          process_status?: string
          processed_at?: string | null
          telegram_user_id?: number | null
          update_id?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          invoice_payload?: string | null
          payload?: Json
          process_status?: string
          processed_at?: string | null
          telegram_user_id?: number | null
          update_id?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  tasks: {
    Tables: {
      referral_commissions: {
        Row: {
          base_amount_kcoin: number
          commission_amount_kcoin: number
          commission_bps: number
          created_at: string
          id: string
          invitee_user_id: string
          inviter_user_id: string
          ledger_id: string | null
          referral_id: string
          source_id: string | null
          source_type: string
          status: string
        }
        Insert: {
          base_amount_kcoin?: number
          commission_amount_kcoin: number
          commission_bps?: number
          created_at?: string
          id?: string
          invitee_user_id: string
          inviter_user_id: string
          ledger_id?: string | null
          referral_id: string
          source_id?: string | null
          source_type?: string
          status?: string
        }
        Update: {
          base_amount_kcoin?: number
          commission_amount_kcoin?: number
          commission_bps?: number
          created_at?: string
          id?: string
          invitee_user_id?: string
          inviter_user_id?: string
          ledger_id?: string | null
          referral_id?: string
          source_id?: string | null
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          amount: number
          created_at: string
          currency_code: string
          id: string
          ledger_id: string | null
          referral_id: string
          reward_role: string
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency_code: string
          id?: string
          ledger_id?: string | null
          referral_id: string
          reward_role: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency_code?: string
          id?: string
          ledger_id?: string | null
          referral_id?: string
          reward_role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          first_open_order_id: string | null
          id: string
          invite_code: string
          invitee_user_id: string
          inviter_user_id: string
          metadata: Json
          qualified_at: string | null
          rewarded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_open_order_id?: string | null
          id?: string
          invite_code: string
          invitee_user_id: string
          inviter_user_id: string
          metadata?: Json
          qualified_at?: string | null
          rewarded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_open_order_id?: string | null
          id?: string
          invite_code?: string
          invitee_user_id?: string
          inviter_user_id?: string
          metadata?: Json
          qualified_at?: string | null
          rewarded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      share_events: {
        Row: {
          created_at: string
          id: string
          payload: Json
          share_type: string
          target: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          share_type: string
          target?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          share_type?: string
          target?: string | null
          user_id?: string
        }
        Relationships: []
      }
      signin_campaigns: {
        Row: {
          active: boolean
          code: string
          created_at: string
          cycle_days: number
          description: string | null
          ends_at: string | null
          id: string
          metadata: Json
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          cycle_days?: number
          description?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          cycle_days?: number
          description?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      signin_days: {
        Row: {
          campaign_id: string
          day_index: number
          id: string
          metadata: Json
          reward: Json
          title: string | null
        }
        Insert: {
          campaign_id: string
          day_index: number
          id?: string
          metadata?: Json
          reward?: Json
          title?: string | null
        }
        Update: {
          campaign_id?: string
          day_index?: number
          id?: string
          metadata?: Json
          reward?: Json
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signin_days_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "signin_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      task_claims: {
        Row: {
          claimed_at: string
          id: string
          metadata: Json
          period_key: string
          reward: Json
          task_id: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          metadata?: Json
          period_key?: string
          reward?: Json
          task_id: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          metadata?: Json
          period_key?: string
          reward?: Json
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_claims_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_definitions: {
        Row: {
          action_type: string | null
          action_url: string | null
          active: boolean
          code: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          metadata: Json
          period_type: string
          reward: Json
          sort_order: number
          starts_at: string | null
          target_count: number
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          action_type?: string | null
          action_url?: string | null
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          period_type?: string
          reward?: Json
          sort_order?: number
          starts_at?: string | null
          target_count?: number
          task_type: string
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string | null
          action_url?: string | null
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          period_type?: string
          reward?: Json
          sort_order?: number
          starts_at?: string | null
          target_count?: number
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_periods: {
        Row: {
          active: boolean
          created_at: string
          ends_at: string
          id: string
          period_key: string
          starts_at: string
          task_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          ends_at: string
          id?: string
          period_key: string
          starts_at: string
          task_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          ends_at?: string
          id?: string
          period_key?: string
          starts_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_periods_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_signins: {
        Row: {
          campaign_id: string
          created_at: string
          day_index: number
          id: string
          reward: Json
          signin_date: string
          status: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          day_index: number
          id?: string
          reward?: Json
          signin_date?: string
          status?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          day_index?: number
          id?: string
          reward?: Json
          signin_date?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_signins_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "signin_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      user_task_progress: {
        Row: {
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          metadata: Json
          period_key: string
          progress_count: number
          status: string
          target_count: number
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          period_key?: string
          progress_count?: number
          status?: string
          target_count?: number
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          period_key?: string
          progress_count?: number
          status?: string
          target_count?: number
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_task_progress_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  album: {
    Enums: {},
  },
  catalog: {
    Enums: {},
  },
  core: {
    Enums: {},
  },
  economy: {
    Enums: {},
  },
  gacha: {
    Enums: {},
  },
  inventory: {
    Enums: {},
  },
  market: {
    Enums: {},
  },
  onchain: {
    Enums: {},
  },
  ops: {
    Enums: {},
  },
  payments: {
    Enums: {},
  },
  tasks: {
    Enums: {},
  },
} as const
