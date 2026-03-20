# @angycode/core

Core library for Angy - provides AI agent tools, providers, and database utilities.

## Installation

```bash
npm install @angycode/core
```

## Features

- **Providers**: Anthropic and Gemini API integrations
- **Tools**: Bash, Read, Write, Edit, Glob, Grep, Think, WebFetch
- **Database**: SQLite-based session, message, and usage storage
- **Agent**: AgentLoop for orchestrating AI interactions

## Usage

```typescript
import { AgentLoop, createAnthropicProvider, createToolRegistry } from '@angycode/core';
```

## License

Apache 2.0 - see [LICENSE.md](./LICENSE.md)
