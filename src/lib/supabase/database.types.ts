
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "achievements": {
                  Row: {
                    "description": string,"icon": string,"id": string,"name": string,"requirement": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"icon": string,"id": string,"name": string,"requirement": string,"sort_order"?: number
                  }
                  Update: {
                    "description"?: string,"icon"?: string,"id"?: string,"name"?: string,"requirement"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"challenge_attempts": {
                  Row: {
                    "challenge_id": string,"created_at": string,"feedback_code": string | null,"id": number,"passed": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "challenge_id": string,"created_at"?: string,"feedback_code"?: string | null,"id"?: never,"passed": boolean,"user_id": string
                  }
                  Update: {
                    "challenge_id"?: string,"created_at"?: string,"feedback_code"?: string | null,"id"?: never,"passed"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenge_attempts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"challenge_completions": {
                  Row: {
                    "challenge_id": string,"chapter_id": string,"completed_at": string,"hints_used": number,"id": number,"tier_id": string,"user_id": string,"xp_awarded": number
                  }
                  ComputedFields: never
                  Insert: {
                    "challenge_id": string,"chapter_id": string,"completed_at"?: string,"hints_used"?: number,"id"?: never,"tier_id": string,"user_id": string,"xp_awarded": number
                  }
                  Update: {
                    "challenge_id"?: string,"chapter_id"?: string,"completed_at"?: string,"hints_used"?: number,"id"?: never,"tier_id"?: string,"user_id"?: string,"xp_awarded"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenge_completions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hint_usages": {
                  Row: {
                    "challenge_id": string,"hint_index": number,"revealed_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "challenge_id": string,"hint_index": number,"revealed_at"?: string,"user_id": string
                  }
                  Update: {
                    "challenge_id"?: string,"hint_index"?: number,"revealed_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hint_usages_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"player_stats": {
                  Row: {
                    "challenges_completed": number,"current_streak": number,"last_completion_date": string | null,"longest_streak": number,"total_xp": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "challenges_completed"?: number,"current_streak"?: number,"last_completion_date"?: string | null,"longest_streak"?: number,"total_xp"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "challenges_completed"?: number,"current_streak"?: number,"last_completion_date"?: string | null,"longest_streak"?: number,"total_xp"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_stats_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_achievements": {
                  Row: {
                    "achievement_id": string,"earned_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achievement_id": string,"earned_at"?: string,"user_id": string
                  }
                  Update: {
                    "achievement_id"?: string,"earned_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_achievements_achievement_id_fkey"
      columns: ["achievement_id"]
isOneToOne: false
      referencedRelation: "achievements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_achievements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"xp_transactions": {
                  Row: {
                    "amount": number,"created_at": string,"id": number,"source_id": string,"source_type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: never,"source_id": string,"source_type": string,"user_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: never,"source_id"?: string,"source_type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xp_transactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "award_challenge":
{ Args: { "p_challenge_id": string,"p_chapter_bonus": number,"p_chapter_challenge_ids": (string)[],"p_chapter_id": string,"p_join_chapter_id": string,"p_tier_bonus": number,"p_tier_challenge_ids": (string)[],"p_tier_id": string,"p_user_id": string,"p_xp": number }; Returns: Json
                           },
"is_valid_timezone":
{ Args: { "tz": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
