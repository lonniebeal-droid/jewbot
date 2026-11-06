import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'agent',
  title: 'Agent',
  description: 'Plan, act, and observe on the local Ollama model. Tools stay inside the project jail.',
  capabilities: ['chat', 'tools'],
  chats: true,
  tools: [
    { name: 'get_project_summary', description: 'Compact tree of the open project.' },
    { name: 'find_files', description: 'Find files by name or glob.' },
    { name: 'search_context', description: 'Search file excerpts.' },
    { name: 'list_dir', description: 'List a directory inside the project.' },
    { name: 'read_file', description: 'Read a file inside the project.' },
    { name: 'write_file', description: 'Propose a file edit. Apply waits for Accept.' },
    { name: 'run_terminal', description: 'Run a local command. Destructive commands wait for confirmation.' },
    { name: 'ssh_exec', description: 'Run a command on an allowlisted SSH host.' },
    { name: 'fleet_list', description: 'List local and allowlisted fleet hosts. No secrets.' },
    { name: 'fleet_health', description: 'Ping local Ollama and curl tags on allowlisted SSH hosts.' },
    { name: 'portfolio_list_gates', description: 'List local portfolio production-readiness gates. No deploy.' },
    { name: 'portfolio_next_free', description: 'Next open portfolio gate with no owner or human blocker.' },
    { name: 'portfolio_mark_gate', description: 'Set one local portfolio gate status. Does not deploy.' },
    { name: 'ask_owner', description: 'Pause for the owner. The model cannot approve this itself.' },
  ],
});
