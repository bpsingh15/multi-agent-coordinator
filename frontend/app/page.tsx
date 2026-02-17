"use client";

import { useEffect, useState, useRef } from "react";
import { supabase, Agent, Task, ActivityLog } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-green-500 animate-pulse",
  waiting: "bg-yellow-500",
  completed: "bg-blue-500",
  pending: "bg-gray-400",
  in_progress: "bg-green-500 animate-pulse",
  handoff: "bg-yellow-500",
  failed: "bg-red-500",
};

const ROLE_ICONS: Record<string, string> = {
  researcher: "🔍",
  writer: "✍️",
  reviewer: "📋",
};

const ACTION_ICONS: Record<string, string> = {
  started: "▶️",
  completed: "✅",
  handoff: "🤝",
  error: "❌",
};

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Initial data fetch
  useEffect(() => {
    fetchAll();
  }, []);

  // Supabase Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("workspace")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        (payload) => {
          setAgents((prev) => {
            const updated = payload.new as Agent;
            const exists = prev.find((a) => a.id === updated.id);
            if (exists)
              return prev.map((a) => (a.id === updated.id ? updated : a));
            return [...prev, updated];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setTasks((prev) => [payload.new as Task, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === (payload.new as Task).id ? (payload.new as Task) : t,
              ),
            );
            setSelectedTask((prev) =>
              prev?.id === (payload.new as Task).id
                ? (payload.new as Task)
                : prev,
            );
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log" },
        (payload) => {
          const newEntry = payload.new as ActivityLog;
          // Fetch agent info for this entry
          supabase
            .from("agents")
            .select("name, role")
            .eq("id", newEntry.agent_id)
            .single()
            .then(({ data }: { data: { name: string; role: string } | null }) => {
              if (data) newEntry.agents = data;
              setActivity((prev) => [newEntry, ...prev].slice(0, 100));
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activity]);

  async function fetchAll() {
    const [agentsRes, tasksRes, activityRes] = await Promise.all([
      fetch(`${API_URL}/agents`).then((r) => r.json()),
      fetch(`${API_URL}/tasks`).then((r) => r.json()),
      fetch(`${API_URL}/activity`).then((r) => r.json()),
    ]);
    setAgents(agentsRes);
    setTasks(tasksRes);
    setActivity(activityRes);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    try {
      await fetch(`${API_URL}/tasks/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      setTopic("");
    } catch (err) {
      console.error("Failed to start pipeline:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (
      !confirm(
        "Reset the entire workspace? This clears all tasks and activity.",
      )
    )
      return;
    await fetch(`${API_URL}/reset`, { method: "POST" });
    setSelectedTask(null);
    fetchAll();
  }

  function timeAgo(date: string) {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  const mainTasks = tasks.filter((t) => !t.parent_task_id);
  const subTasks = (parentId: string) =>
    tasks.filter((t) => t.parent_task_id === parentId);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Multi-Agent Coordinator
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Assign tasks to AI agents and watch them collaborate in real-time
            </p>
          </div>
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition"
          >
            Reset Workspace
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter a topic (e.g., 'The future of renewable energy')..."
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-medium transition"
          >
            {loading ? "Starting..." : "Run Pipeline"}
          </button>
        </form>

        {/* Agents Status Bar */}
        <div className="grid grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4"
            >
              <span className="text-3xl">{ROLE_ICONS[agent.role] || "🤖"}</span>
              <div className="flex-1">
                <div className="font-medium">{agent.name}</div>
                <div className="text-sm text-gray-400 capitalize">
                  {agent.role}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]}`}
                />
                <span className="text-sm capitalize text-gray-400">
                  {agent.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Main Grid: Tasks + Activity */}
        <div className="grid grid-cols-5 gap-6">
          {/* Tasks Panel */}
          <div className="col-span-3 space-y-4">
            <h2 className="text-lg font-semibold text-gray-300">Tasks</h2>
            {mainTasks.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
                No tasks yet. Enter a topic above to start the pipeline.
              </div>
            ) : (
              mainTasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-800/50 transition"
                    onClick={() =>
                      setSelectedTask(
                        selectedTask?.id === task.id ? null : task,
                      )
                    }
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{task.title}</h3>
                      <span
                        className={`px-3 py-1 text-xs rounded-full text-white ${STATUS_COLORS[task.status]}`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-sm text-gray-400 mt-1">
                        {task.description}
                      </p>
                    )}
                  </div>

                  {/* Sub-tasks */}
                  {subTasks(task.id).length > 0 && (
                    <div className="border-t border-gray-800 bg-gray-900/50">
                      {subTasks(task.id).map((sub) => (
                        <div
                          key={sub.id}
                          className="px-4 py-3 border-b border-gray-800/50 last:border-0 flex items-center justify-between cursor-pointer hover:bg-gray-800/30"
                          onClick={() => setSelectedTask(sub)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-gray-600">↳</span>
                            <span className="text-sm">{sub.title}</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full text-white ${STATUS_COLORS[sub.status]}`}
                          >
                            {sub.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Task Detail Modal */}
            {selectedTask?.result && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-blue-400">
                    {selectedTask.title} — Result
                  </h3>
                  <button
                    onClick={() => setSelectedTask(null)}
                    className="text-gray-500 hover:text-gray-300"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto bg-gray-950 rounded-lg p-4">
                  {selectedTask.result}
                </div>
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div className="col-span-2">
            <h2 className="text-lg font-semibold text-gray-300 mb-4">
              Live Activity
            </h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 max-h-[600px] overflow-y-auto space-y-3">
              {activity.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  Waiting for activity...
                </div>
              ) : (
                [...activity].reverse().map((entry) => (
                  <div key={entry.id} className="flex gap-3 text-sm">
                    <span className="mt-0.5">
                      {ACTION_ICONS[entry.action] || "📌"}
                    </span>
                    <div className="flex-1">
                      <span className="font-medium text-blue-400">
                        {entry.agents?.name || "Agent"}
                      </span>
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="text-gray-500">
                        {timeAgo(entry.created_at)}
                      </span>
                      <p className="text-gray-300 mt-0.5">{entry.message}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
