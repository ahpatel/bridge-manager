package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Response struct for JSON output
type Response struct {
	Status  string `json:"status"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Global map to track background processes
var (
	processes = make(map[string]*exec.Cmd)
	procMutex sync.Mutex
)

// Handler to execute bbctl commands
func bbctlHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var data struct {
		Args []string `json:"args"`
		Async bool     `json:"async"`
	}

	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("Executing bbctl %s (async: %v)", strings.Join(data.Args, " "), data.Async)

	// Execute bbctl
	cmd := exec.Command("bbctl", data.Args...)
	
	// Set environment variables for persistence in /data
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "HOME=/data")
	cmd.Env = append(cmd.Env, "XDG_CONFIG_HOME=/data/.config")
	cmd.Env = append(cmd.Env, "XDG_DATA_HOME=/data/.local/share")
	cmd.Env = append(cmd.Env, "XDG_CACHE_HOME=/data/.cache")

	if data.Async {
		// Run in background
		err := cmd.Start()
		if err != nil {
			resp := Response{Status: "error", Error: err.Error()}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		
		bridgeName := "unknown"
		if len(data.Args) > 1 && data.Args[0] == "run" {
			bridgeName = data.Args[1]
		}
		
		procMutex.Lock()
		processes[bridgeName] = cmd
		procMutex.Unlock()

		go func() {
			err := cmd.Wait()
			log.Printf("Background process bbctl %s finished with error: %v", strings.Join(data.Args, " "), err)
			procMutex.Lock()
			delete(processes, bridgeName)
			procMutex.Unlock()
		}()

		resp := Response{Status: "success", Output: "Process started in background"}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// Foreground execution (default)
	output, err := cmd.CombinedOutput()
	resp := Response{
		Status: "success",
		Output: string(output),
	}
	if err != nil {
		resp.Status = "error"
		resp.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Handler to list running processes
func listProcsHandler(w http.ResponseWriter, r *http.Request) {
	procMutex.Lock()
	defer procMutex.Unlock()
	
	var running []string
	for name := range processes {
		running = append(running, name)
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(running)
}

// Simple status handler
func statusHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Beeper Bridge Manager API is running. Instance ID: %s", os.Getenv("CLOUDFLARE_DURABLE_OBJECT_ID"))
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", statusHandler)
	mux.HandleFunc("/api/bbctl", bbctlHandler)
	mux.HandleFunc("/api/procs", listProcsHandler)

	log.Printf("Starting server on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
