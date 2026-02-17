import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from config import supabase
from agents import run_pipeline

app = FastAPI(title="Multi-Agent Task Coordinator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TaskRequest(BaseModel):
    topic: str


class ResetRequest(BaseModel):
    pass


@app.get("/agents")
async def get_agents():
    """Get all agents and their current status."""
    result = supabase.table("agents").select("*").execute()
    return result.data


@app.get("/tasks")
async def get_tasks():
    """Get all tasks ordered by creation time."""
    result = supabase.table("tasks").select("*").order("created_at", desc=True).execute()
    return result.data


@app.get("/activity")
async def get_activity():
    """Get recent activity log."""
    result = (supabase.table("activity_log")
              .select("*, agents(name, role)")
              .order("created_at", desc=True)
              .limit(50)
              .execute())
    return result.data


@app.post("/tasks/run")
async def create_and_run_task(request: TaskRequest):
    """Submit a topic and kick off the full agent pipeline."""
    if not request.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty")

    # Run pipeline in background so we can return immediately
    asyncio.create_task(run_pipeline(request.topic))

    return {"message": "Pipeline started", "topic": request.topic}


@app.post("/reset")
async def reset_workspace():
    """Reset all agents to idle and clear tasks/activity."""
    supabase.table("activity_log").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("agents").update({
        "status": "idle",
        "current_task_id": None
    }).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    return {"message": "Workspace reset"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)