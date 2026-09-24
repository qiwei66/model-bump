import anthropic

client = anthropic.Anthropic()


def classify(ticket: str) -> str:
    resp = client.messages.create(
        model="claude-opus-5",
        max_tokens=512,
        temperature=0,
        thinking={"type": "disabled"},
        tools=[CATEGORY_TOOL],
        tool_choice={"type": "tool", "name": "category"},
        messages=[{"role": "user", "content": ticket}],
    )
    return resp.content[0].input["category"]


def summarize(ticket: str) -> str:
    resp = client.messages.create(
        model="claude-opus-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": f"Summarize:\n{ticket}"}],
    )
    return resp.content[0].text
