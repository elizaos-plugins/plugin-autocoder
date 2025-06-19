#!/bin/bash

# Monitor SWE-bench comprehensive benchmark progress
LOG_FILE=$(ls swe-bench-full-run-*.log 2>/dev/null | head -1)

if [ -z "$LOG_FILE" ]; then
    echo "❌ No benchmark log file found"
    exit 1
fi

echo "🔍 Monitoring SWE-bench comprehensive benchmark..."
echo "📄 Log file: $LOG_FILE"
echo "📊 Progress tracking started at $(date)"
echo "════════════════════════════════════════════════════════════════"

# Check if process is still running
check_process() {
    ps aux | grep "run-swe-bench-simple.ts" | grep -v grep > /dev/null
    return $?
}

# Extract progress info
get_progress() {
    if [ -f "$LOG_FILE" ]; then
        # Get current instance being processed
        CURRENT=$(tail -50 "$LOG_FILE" | grep "Processing [0-9]*/[0-9]*:" | tail -1)
        
        # Get total instances
        TOTAL=$(grep "Processing .* instances" "$LOG_FILE" | tail -1)
        
        # Get any completed instances
        COMPLETED=$(grep -c "success.*true\|success.*false" "$LOG_FILE" 2>/dev/null || echo "0")
        
        # Get last significant activity
        LAST_ACTIVITY=$(tail -5 "$LOG_FILE" | grep -E "\[CLAUDE-CODE-PATCH\]|\[SWE-BENCH\]|\[REPO-MANAGER\]" | tail -1)
        
        echo "📈 $TOTAL"
        echo "🔄 $CURRENT"
        echo "✅ Completed instances: $COMPLETED"
        echo "⚡ Latest: $LAST_ACTIVITY"
        echo "────────────────────────────────────────────────────────────────"
    fi
}

# Monitor loop
while check_process; do
    clear
    echo "🔍 SWE-bench Comprehensive Benchmark Monitor"
    echo "📄 Log: $LOG_FILE"
    echo "🕐 Time: $(date)"
    echo "════════════════════════════════════════════════════════════════"
    get_progress
    echo ""
    echo "⏳ Process is running... (checking every 30 seconds)"
    echo "📊 Run 'tail -f $LOG_FILE' for real-time logs"
    sleep 30
done

echo ""
echo "🏁 Benchmark process completed!"
echo "📊 Final results:"
get_progress

# Check for results directory
RESULTS_DIR=".swe-bench-cache/results"
if [ -d "$RESULTS_DIR" ]; then
    echo ""
    echo "📁 Results saved in: $RESULTS_DIR"
    ls -la "$RESULTS_DIR"/*.json 2>/dev/null | tail -3
fi

echo ""
echo "📋 Summary report will be generated shortly..."
echo "════════════════════════════════════════════════════════════════"