---
name: deploy
description: Build and deploy a Docker container on the host machine. Write code to /workspace/group/{dir}/, then use this skill to build and run it. Host executes docker build/run and returns the result.
---

# /deploy — Build & Deploy to Host Docker

Use this skill when you have written code and want to build and run it as a Docker container on the host machine.

## How it works

1. You write your code + Dockerfile to `/workspace/group/{yourapp}/`
2. Drop a deploy request JSON to `/workspace/ipc/deploy/{id}.json`
3. The host picks it up, runs `docker build` then `docker run -d`
4. Result (success/error + logs) appears at `/workspace/ipc/deploy/{id}.response.json`

## Deploy request format

Write this JSON to `/workspace/ipc/deploy/{id}.json`:

```json
{
  "id": "unique-id",
  "image": "myapp:latest",
  "contextPath": "myapp",
  "dockerfile": "Dockerfile",
  "ports": ["3000:3000"],
  "env": {
    "NODE_ENV": "production"
  },
  "containerName": "myapp"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique string, used for response filename |
| `image` | yes | Docker image tag to build |
| `contextPath` | yes | Path relative to `/workspace/group/` where Dockerfile lives |
| `dockerfile` | no | Dockerfile filename within contextPath (default: `Dockerfile`) |
| `ports` | no | Port mappings e.g. `["3000:3000"]` |
| `env` | no | Environment variables for the running container |
| `containerName` | no | Container name — existing container with this name is replaced |

## Step-by-step

### 1. Write your app

```bash
mkdir -p /workspace/group/myapp
# write Dockerfile, source files, etc.
```

### 2. Submit deploy request

```bash
mkdir -p /workspace/ipc/deploy
cat > /workspace/ipc/deploy/deploy-001.json << 'EOF'
{
  "id": "deploy-001",
  "image": "myapp:latest",
  "contextPath": "myapp",
  "ports": ["3000:3000"],
  "containerName": "myapp"
}
EOF
```

### 3. Poll for result

The host processes IPC every few seconds. Poll until the response file appears:

```bash
for i in $(seq 1 60); do
  if [ -f /workspace/ipc/deploy/deploy-001.response.json ]; then
    cat /workspace/ipc/deploy/deploy-001.response.json
    break
  fi
  sleep 3
done
```

### 4. Read result

```json
{
  "id": "deploy-001",
  "status": "success",
  "output": "=== docker build ===\n...\n=== docker run ===\n<container-id>"
}
```

On error, `status` is `"error"` and `error` field contains the message.

## Notes

- `contextPath` must be within your group folder — paths that escape it are rejected
- The container runs detached (`-d`). To check if it's running, the host has docker access; ask via a follow-up message if needed
- Build timeout: 5 minutes. Run timeout: 1 minute
- If `containerName` is set, any existing container with that name is stopped and replaced
