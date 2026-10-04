#!/usr/bin/env bash
# Live per-replica counter of search requests: shows client-side load balancing in the terminal.
# Run it, then click "Fire 60 searches" in the Control room (or search in the UI). Ctrl+C to stop.
#   docker compose up -d --scale search-service=3 search-service   # add a replica first, if you like
cd "$(dirname "$0")/.."
echo "Replicas: $(docker compose ps search-service --format '{{.Name}}' | tr '\n' ' ')"
echo "Waiting for searches... (Ctrl+C to stop)"
# mawk (Ubuntu's default awk) reads pipes in big blocks; -W interactive makes it react per line.
AWK=(awk); awk -W version 2>&1 | grep -qi mawk && AWK=(awk -W interactive)
docker compose logs -f --since 0s --no-color search-service 2>/dev/null | "${AWK[@]}" '
  / SEARCH / {
    replica = $1
    if (!(replica in count)) {            # keep replica names sorted (portable: no gawk asorti)
      n++; names[n] = replica
      for (i = n; i > 1 && names[i] < names[i-1]; i--) { t = names[i]; names[i] = names[i-1]; names[i-1] = t }
    }
    count[replica]++; total++
    printf "\033[H\033[2J  Search requests per replica (total %d)\n\n", total
    for (i = 1; i <= n; i++) {
      bar = ""; for (j = 0; j < count[names[i]] && j < 40; j++) bar = bar "#"
      printf "  %-18s %4d  %s\n", names[i], count[names[i]], bar
    }
    fflush()
  }'
