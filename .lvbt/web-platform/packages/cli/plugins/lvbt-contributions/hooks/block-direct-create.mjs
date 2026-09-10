const reason = 'Use the mandatory github-contribution skill and its github-create helper.';

function commandFrom(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  return [input.command, input.cmd, input.script]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

function isCreateTool(toolName) {
  return /(?:^|__|_)(?:create_issue|create_pull_request|create_pr)$/i.test(toolName);
}

function isCreateCommand(command) {
  if (/\bgh\s+(?:issue|pr)\s+create\b/i.test(command)) return true;

  const writesIssues =
    /\bgh\s+api\b[\s\S]*--method\s+(?:POST|PUT|PATCH)\b/i.test(command) &&
    /(?:repos\/[^\s'"]+\/[^\s'"]+\/(?:issues|pulls))\b/i.test(command);
  return writesIssues;
}

export function decision(payload) {
  const toolName = String(payload.tool_name ?? payload.toolName ?? '');
  if (!isCreateTool(toolName) && !isCreateCommand(commandFrom(payload))) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export async function run() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const payload = input.trim() ? JSON.parse(input) : {};
  process.stdout.write(`${JSON.stringify(decision(payload))}\n`);
}
