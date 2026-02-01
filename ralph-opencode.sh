#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations> [PLAN_FILE] [PROGRESS_FILE]"
  echo "Example: $0 10 PLAN.md progress.txt"
  exit 1
fi

MAX_ITERATIONS=$1
PLAN_FILE="${2:-PLAN.md}"
PROGRESS_FILE="${3:-progress.txt}"

# Initialize progress file if needed
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "=== Progress Log Started: $(date) ===" > "$PROGRESS_FILE"
  echo "" >> "$PROGRESS_FILE"
fi

for ((i=1; i<=$MAX_ITERATIONS; i++)); do
  echo ""
  echo "=========================================="
  echo "Iteration $i of $MAX_ITERATIONS"
  echo "=========================================="
  echo ""
  
  # Run opencode with message first, then file attachments
  # Capture result and handle errors explicitly instead of using set -e
  echo "Running opencode..."
  result=$(opencode run \
    "Review the attached plan and progress files. Work on the highest-priority pending task: 1) Implement exactly ONE task from the plan, 2) Run all tests and checks (composer test, analyse, lint), 3) Update the plan file to mark completion, 4) Append progress to progress.txt, 5) Commit changes. Only work on ONE task at a time. Output <promise>COMPLETE</promise> when all tasks are done." \
    -f "$PLAN_FILE" \
    -f "$PROGRESS_FILE" </dev/null 2>&1) || {
      echo "Warning: opencode exited with error, continuing..."
      result="ERROR: opencode failed"
  }
  
  echo "$result"
  
  # Check if complete
  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo ""
    echo "=========================================="
    echo "✓ PRD complete after $i iterations!"
    echo "=========================================="
    exit 0
  fi
  
  # Continue to next iteration
  if [ $i -lt $MAX_ITERATIONS ]; then
    echo ""
    echo "Task not complete. Continuing to next iteration..."
    sleep 2
  fi
done

echo ""
echo "=========================================="
echo "Reached maximum iterations ($MAX_ITERATIONS)"
echo "PRD may not be complete. Check $PROGRESS_FILE"
echo "=========================================="
exit 1
