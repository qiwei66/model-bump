import anthropic
from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel

client = anthropic.Anthropic()
MODEL = "claude-opus-5"


class Weather(BaseModel):
    city: str


def ask(q: str) -> str:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        temperature=0,
        thinking={"type": "disabled"},
        tool_choice={"type": "tool", "name": "get_weather"},
        tools=[{"name": "get_weather", "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}}],
        messages=[
            {"role": "user", "content": q},
            {"role": "assistant", "content": "{"},
        ],
    )
    return resp.content[0].text


def deep(q: str):
    return client.messages.create(
        model="claude-opus-4-6",
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 8000},
        messages=[{"role": "user", "content": q}],
    )


llm = ChatAnthropic(model="claude-opus-5", temperature=0)
structured = llm.with_structured_output(Weather)
forced = llm.bind_tools([Weather], tool_choice="any")
