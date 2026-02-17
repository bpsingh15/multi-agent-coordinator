import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: "idle" | "working" | "waiting" | "completed";
  current_task_id: string | null;
  last_active: string;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "handoff" | "completed" | "failed";
  assigned_agent_id: string | null;
  parent_task_id: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  agent_id: string;
  task_id: string;
  action: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
  agents?: { name: string; role: string };
};
