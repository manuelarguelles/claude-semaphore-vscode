'use strict';
const EVENTS = {
  claude: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'],
};
function normalizeEvent(provider, raw, now) {
  if (!EVENTS[provider] || !raw || typeof raw !== 'object' || raw.agent_id || raw.agent_type || raw.parent_session_id) return;
  if (typeof raw.session_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(raw.session_id)) return;
  if (typeof raw.cwd !== 'string' || !raw.cwd || raw.cwd.length > 4096 || /[\x00-\x1f]/.test(raw.cwd)) return;
  if (!EVENTS[provider].includes(raw.hook_event_name) || !Number.isFinite(now) || now < 0) return;
  if (raw.hook_event_name === 'Notification' && !['permission_prompt', 'elicitation_dialog', 'input_needed'].includes(raw.notification_type)) return;
  let event = raw.hook_event_name;
  if (event === 'PreToolUse' && /(^|\.)request_user_input(?:_async)?$|^AskUserQuestion$/.test(raw.tool_name || '')) event = 'Question';
  const out = { provider, sessionId: raw.session_id, cwd: raw.cwd, event, at: now };
  if (typeof raw.turn_id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(raw.turn_id)) out.turnId = raw.turn_id;
  return out;
}
module.exports = { normalizeEvent, EVENTS };
