import json
from datetime import datetime, timezone
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from config import supabase, OPENAI_API_KEY

llm = ChatOpenAI(model="gpt-4o-mini", api_key=OPENAI_API_KEY, temperature=0.7)


def log_activity(agent_id: str, task_id: str, action: str, message: str, metadata: dict = None):
    """Log agent activity to Supabase for real-time display."""
    supabase.table("activity_log").insert({
        "agent_id": agent_id,
        "task_id": task_id,
        "action": action,
        "message": message,
        "metadata": metadata or {}
    }).execute()


def update_agent_status(agent_id: str, status: str, task_id: str = None):
    """Update an agent's status in the database."""
    data = {
        "status": status,
        "last_active": datetime.now(timezone.utc).isoformat(),
    }
    if task_id:
        data["current_task_id"] = task_id
    else:
        data["current_task_id"] = None
    supabase.table("agents").update(data).eq("id", agent_id).execute()


def update_task(task_id: str, status: str, result: str = None, assigned_agent_id: str = None):
    """Update a task's status and result."""
    data = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if result:
        data["result"] = result
    if assigned_agent_id:
        data["assigned_agent_id"] = assigned_agent_id
    supabase.table("tasks").update(data).eq("id", task_id).execute()


# --- Define Tools for each agent role ---

@tool
def search_knowledge(query: str) -> str:
    """Search for information on a given topic. Returns research findings."""
    # In a real app, you'd call a search API. Here the LLM simulates research.
    return f"Research findings for: {query}"


@tool
def write_content(topic: str, research: str) -> str:
    """Write content based on research findings. Returns written content."""
    return f"Written content about {topic} based on: {research}"


@tool
def review_content(content: str) -> str:
    """Review content for quality and accuracy. Returns review feedback."""
    return f"Review of: {content}"


AGENT_CONFIGS = {
    "researcher": {
        "system_prompt": """You are a Research Agent. Your job is to research topics thoroughly.
When given a task, research the topic and provide comprehensive findings.
Always use the search_knowledge tool to gather information.
Provide your findings in a clear, structured format with key points.""",
        "tools": [search_knowledge],
    },
    "writer": {
        "system_prompt": """You are a Writer Agent. Your job is to create well-written content.
When given research findings, transform them into polished, engaging content.
Use the write_content tool and then refine the output.
Make sure the content is clear, well-organized, and engaging.""",
        "tools": [write_content],
    },
    "reviewer": {
        "system_prompt": """You are a Reviewer Agent. Your job is to review and improve content.
When given content, evaluate it for accuracy, clarity, and quality.
Use the review_content tool and provide specific, actionable feedback.
Give a final verdict: APPROVED or NEEDS_REVISION with clear reasoning.""",
        "tools": [review_content],
    },
}


def create_agent_executor(role: str) -> AgentExecutor:
    """Create a LangChain agent executor for a given role."""
    config = AGENT_CONFIGS[role]
    prompt = ChatPromptTemplate.from_messages([
        ("system", config["system_prompt"]),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_openai_functions_agent(llm, config["tools"], prompt)
    return AgentExecutor(agent=agent, tools=config["tools"], verbose=True)


async def run_agent(agent_id: str, role: str, task_id: str, input_text: str) -> str:
    """Run an agent on a task and update all statuses in Supabase."""
    # Mark agent as working
    update_agent_status(agent_id, "working", task_id)
    update_task(task_id, "in_progress", assigned_agent_id=agent_id)
    log_activity(agent_id, task_id, "started", f"{role.title()} agent picking up task")

    try:
        executor = create_agent_executor(role)
        result = await executor.ainvoke({"input": input_text})
        output = result["output"]

        log_activity(agent_id, task_id, "completed", f"{role.title()} agent finished work",
                     {"output_preview": output[:200]})

        # Mark agent as idle
        update_agent_status(agent_id, "idle")

        return output

    except Exception as e:
        log_activity(agent_id, task_id, "error", f"Agent encountered an error: {str(e)}")
        update_agent_status(agent_id, "idle")
        update_task(task_id, "failed", result=str(e))
        raise


async def run_pipeline(topic: str):
    """
    Run the full multi-agent pipeline:
    1. Researcher researches the topic
    2. Writer creates content from research
    3. Reviewer reviews the final content
    """
    # Fetch agents from DB
    agents_res = supabase.table("agents").select("*").execute()
    agents = {a["role"]: a for a in agents_res.data}

    # Create the main task
    main_task = supabase.table("tasks").insert({
        "title": f"Create content about: {topic}",
        "description": f"Full pipeline: research, write, and review content about {topic}",
        "status": "pending"
    }).execute().data[0]
    main_task_id = main_task["id"]

    # --- Step 1: Research ---
    research_task = supabase.table("tasks").insert({
        "title": f"Research: {topic}",
        "status": "pending",
        "parent_task_id": main_task_id
    }).execute().data[0]

    log_activity(agents["researcher"]["id"], research_task["id"], "handoff",
                 "Task assigned to Researcher agent")

    research_result = await run_agent(
        agents["researcher"]["id"],
        "researcher",
        research_task["id"],
        f"Research the following topic thoroughly and provide detailed findings: {topic}"
    )
    update_task(research_task["id"], "completed", result=research_result)

    # --- Step 2: Write (handoff from researcher) ---
    write_task = supabase.table("tasks").insert({
        "title": f"Write: {topic}",
        "status": "pending",
        "parent_task_id": main_task_id
    }).execute().data[0]

    log_activity(agents["researcher"]["id"], write_task["id"], "handoff",
                 "Researcher handing off to Writer agent")
    log_activity(agents["writer"]["id"], write_task["id"], "handoff",
                 "Writer agent receiving research findings")

    write_result = await run_agent(
        agents["writer"]["id"],
        "writer",
        write_task["id"],
        f"Based on the following research, write a polished article about {topic}:\n\n{research_result}"
    )
    update_task(write_task["id"], "completed", result=write_result)

    # --- Step 3: Review (handoff from writer) ---
    review_task = supabase.table("tasks").insert({
        "title": f"Review: {topic}",
        "status": "pending",
        "parent_task_id": main_task_id
    }).execute().data[0]

    log_activity(agents["writer"]["id"], review_task["id"], "handoff",
                 "Writer handing off to Reviewer agent")
    log_activity(agents["reviewer"]["id"], review_task["id"], "handoff",
                 "Reviewer agent receiving content for review")

    review_result = await run_agent(
        agents["reviewer"]["id"],
        "reviewer",
        review_task["id"],
        f"Review the following article for quality, accuracy, and clarity:\n\n{write_result}"
    )
    update_task(review_task["id"], "completed", result=review_result)

    # Mark main task as completed
    final_result = {
        "research": research_result,
        "article": write_result,
        "review": review_result
    }
    update_task(main_task_id, "completed", result=json.dumps(final_result))

    return final_result