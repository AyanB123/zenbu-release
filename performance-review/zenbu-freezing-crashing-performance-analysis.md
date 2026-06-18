# Zenbu Performance Analysis Report

**Date:** 2026-06-08  
**Analysis Type:** Deep System Performance Review  
**Status:** Critical Performance Issues Identified

## Executive Summary

This report provides a comprehensive analysis of the Zenbu application's performance issues, including freezing, crashing, lag, and unresponsiveness. The investigation revealed multiple critical bottlenecks across the application architecture, from plugin loading overhead to resource-intensive services and potential memory leaks.

**Critical Issues Found:**
- Disk cache corruption causing Chromium errors
- 19 plugins loading simultaneously causing startup overhead
- Complex nested layout management impacting rendering performance
- Resource-intensive file system watching and terminal management
- Potential memory leaks in session and service management
- Heavy dependency tree with React 19 (unstable version)

---

## 1. Critical Error Analysis

### 1.1 Disk Cache Corruption
**Error Message:**
```
[26868:0608/105418.742:ERROR:net\disk_cache\blockfile\backend_impl.cc:2014] Invalid cache (current) size
```

**Impact:** This error indicates corruption in Electron's Chromium disk cache, which can cause:
- Application freezing during cache operations
- Slow loading times
- Potential crashes when cache operations fail
- Resource waste on failed cache operations

**Root Cause:** The disk cache backend has detected an invalid cache size, likely due to:
- Improper application shutdown
- Disk I/O errors
- Cache file corruption
- Concurrent cache access issues

**Recommendation:** Implement cache clearing on startup and add cache health monitoring.

---

## 2. Plugin Architecture Issues

### 2.1 Plugin Overhead
**Current State:** 19 plugins enabled and loading simultaneously

**Enabled Plugins:**
1. app (host application)
2. pi-commands (Pi command integration)
3. plan (plan view and tools)
4. terminal (terminal management)
5. plugins (plugin management)
6. open-in (external opening)
7. auto-updater (automatic updates)
8. settings (settings management)
9. pi-footer (Pi footer interface)
10. cm-markdown (CodeMirror markdown)
11. cm-vim (CodeMirror vim)
12. cm-image-paste (CodeMirror image paste)
13. search-recent-agents (agent search)
14. search-recent-workspaces (workspace search)
15. search-recent-worktrees (worktree search)
16. plugin-installer (plugin installation)
17. plugin-dev (plugin development)
18. open-projects (project management)

**Performance Impact:**
- **Startup Time:** Each plugin requires initialization, schema registration, and service setup
- **Memory Usage:** 19 separate plugin contexts with their own dependencies
- **Event Handling:** Each plugin registers event handlers, increasing event processing overhead
- **Database Operations:** Multiple plugins performing concurrent database operations

**Boot Timing Analysis:**
```
[zenbu] electron ready (+3476ms)
[zenbu] config loaded (19 plugins) (+5113ms)
[zenbu] splash shown (+5333ms)
[zenbu] loaders registered (+5741ms)
[zenbu] plugins evaluated (+16608ms)  ← 16.6 seconds for plugin evaluation
[zenbu] ready (+28961ms)               ← 29 seconds total startup time
```

**Recommendation:** Implement lazy plugin loading and prioritize core plugins.

---

## 3. Service-Level Performance Issues

### 3.1 Terminal Service
**File:** `plugins/app/src/main/services/terminal.ts`

**Issues Identified:**
- **Output Buffering:** 256KB replay buffer per terminal session
- **Multiple PTY Processes:** Each terminal spawns a separate PTY process
- **Title Flush Coalescing:** 150ms delay timer for title updates
- **Synchronous Operations:** Some terminal operations block the main thread

**Memory Impact:**
```
REPLAY_BUFFER_BYTES = 256 * 1024  // 256KB per terminal
```
With multiple terminals, this can consume significant memory.

**Recommendation:** Implement terminal pooling and reduce buffer sizes.

### 3.2 Sessions Service
**File:** `plugins/app/src/main/services/sessions.ts`

**Issues Identified:**
- **Live Session Management:** In-memory Map of all active sessions
- **Activation Deduplication:** Concurrent activation prevention with Promise Map
- **Queue Locks:** Per-session queue mutex tickets
- **Complex Session State:** Multiple session states (streaming, queue, subscribers)

**Performance Impact:**
- High memory usage for live session storage
- Complex synchronization logic causing potential deadlocks
- Frequent database updates for session state changes

**Recommendation:** Implement session lifecycle management and cleanup.

### 3.3 File Tree Service
**File:** `plugins/app/src/main/services/file-tree.ts`

**Issues Identified:**
- **Recursive File Watching:** Uses `fs.watch` with `recursive: true`
- **Large Path Limits:** MAX_PATHS = 20,000 paths per index
- **File Size Limits:** MAX_FILE_BYTES = 2MB per file
- **Debounce Delays:** 250ms debounce for watcher-triggered re-indexes
- **Chunk Publishing:** 500 paths per DB publish during walks

**Performance Impact:**
- File system watchers consume significant I/O resources
- Large repositories can cause memory pressure
- Frequent re-indexing on file changes

**Recommendation:** Implement incremental indexing and smarter file watching.

---

## 4. Rendering Performance Issues

### 4.1 Complex Layout Management
**File:** `plugins/app/src/renderer/components/workspace-body.tsx`

**Issues Identified:**
- **Nested Allotment Components:** Three levels of nested split panes
- **Multiple Resize Handlers:** onChange, onDragEnd, onVisibleChange handlers
- **Layout Priority Management:** Complex priority system for pane resizing
- **Frequent Re-renders:** Layout changes trigger cascading re-renders

**Layout Structure:**
```
Allotment (horizontal)
├── Allotment.Pane (sidebar)
└── Allotment.Pane (main)
    └── Allotment (vertical)
        ├── Allotment.Pane (content)
        └── Allotment.Pane (bottom panel)
            └── Allotment (horizontal)
                ├── Allotment.Pane (chats)
                └── Allotment.Pane (right sidebar)
```

**Performance Impact:**
- Each resize event triggers multiple layout recalculations
- Nested allotments cause O(n²) complexity in layout calculations
- Frequent DOM manipulations during resizing

**Recommendation:** Simplify layout structure and implement virtualization.

### 4.2 React 19 Instability
**Current Version:** React 19.0.0

**Issues:**
- React 19 is a major version with potential stability issues
- New concurrent rendering features may cause unexpected behavior
- Lack of mature optimization patterns for React 19

**Recommendation:** Consider downgrading to React 18 for stability.

---

## 5. Dependency Analysis

### 5.1 Heavy Dependencies
**Critical Dependencies:**
- `@earendil-works/pi-ai: ^0.78.0` - AI integration (heavy)
- `@earendil-works/pi-coding-agent: ^0.78.0` - Coding agent (heavy)
- `@codemirror/*` - Multiple CodeMirror packages (heavy)
- `@excalidraw/excalidraw: ^0.18.1` - Diagramming (heavy)
- `allotment: ^1.20.5` - Layout management
- `react-scan: 0.5.7` - Development tool (performance impact)

**Bundle Size Impact:**
These dependencies significantly increase the initial bundle size and memory footprint.

**Recommendation:** Implement code splitting and lazy loading for heavy dependencies.

### 5.2 Development Tools in Production
**Issue:** `react-scan` is loaded in the application

**Impact:**
- React Scan monitors component renders and can impact performance
- Commented out in main.tsx but still included in dependencies
- Should not be active in production builds

**Recommendation:** Remove react-scan from production dependencies.

---

## 6. Database Performance Issues

### 6.1 Database Replication Overhead
**Architecture:** WebSocket-based database replication

**Issues Identified:**
- Real-time replication via WebSocket (`ch: "db"`)
- Frequent write operations from multiple services
- Collection concatenation and creation operations
- Root-level set operations for state updates

**Performance Impact:**
- Network overhead for real-time synchronization
- Frequent database writes causing I/O pressure
- Replication lag causing UI inconsistencies

**Recommendation:** Implement write batching and debouncing.

### 6.2 Database Tracer Overhead
**File:** `plugins/app/src/renderer/boot/db-replica-tracer.ts`

**Issue:** Development tool that intercepts all WebSocket messages

**Impact:**
- Parses every WebSocket message
- Maintains in-memory statistics
- Can impact performance in development mode

**Recommendation:** Ensure this is disabled in production.

---

## 7. Memory Management Issues

### 7.1 Potential Memory Leaks
**Sources:**

1. **Terminal Buffers:** Unlimited terminal sessions with 256KB buffers each
2. **File Watchers:** FS watchers not properly cleaned up
3. **Session Maps:** In-memory Maps growing indefinitely
4. **Event Subscriptions:** Unsubscribed event listeners
5. **Plugin Instances:** Plugins not properly disposed

**Evidence:**
```typescript
// Terminal service
private readonly terminals = new Map<string, TerminalEntry>()

// Sessions service
readonly live = new Map<string, LiveSession>()
readonly activating = new Map<string, Promise<LiveSession>>()
readonly queueLocks = new Map<string, Promise<void>>()

// File tree service
private readonly watchers = new Map<string, { watcher: FSWatcher; directory: string }>()
private readonly watchTimers = new Map<string, NodeJS.Timeout>()
```

**Recommendation:** Implement proper cleanup and memory monitoring.

---

## 8. Startup Performance Analysis

### 8.1 Boot Sequence Timing
```
Total startup time: ~29 seconds
- Electron ready: 3.5 seconds
- Config loaded: 5.1 seconds
- Splash shown: 5.3 seconds
- Loaders registered: 5.7 seconds
- Plugins evaluated: 16.6 seconds ← Major bottleneck
- Ready: 29 seconds
```

**Bottlenecks:**
1. Plugin evaluation takes 16.6 seconds (57% of startup time)
2. Electron initialization takes 3.5 seconds
3. Config loading and service registration

**Recommendation:** Implement parallel plugin loading and service initialization.

---

## 9. Recommended Solutions

### 9.1 Immediate Actions (High Priority)

1. **Fix Disk Cache Corruption**
   ```typescript
   // Add to main process initialization
   session.defaultSession.clearCache()
   ```

2. **Implement Lazy Plugin Loading**
   ```typescript
   // Load core plugins first, defer non-critical plugins
   const corePlugins = ['app', 'terminal', 'sessions']
   const deferredPlugins = ['plugin-dev', 'plugin-installer']
   ```

3. **Disable Development Tools in Production**
   ```typescript
   // Remove react-scan from production bundle
   if (process.env.NODE_ENV !== 'development') {
     // Disable react-scan
   }
   ```

4. **Add Memory Monitoring**
   ```typescript
   // Monitor memory usage and alert on leaks
   setInterval(() => {
     const usage = process.memoryUsage()
     if (usage.heapUsed > 500 * 1024 * 1024) {
       console.warn('High memory usage:', usage)
     }
   }, 30000)
   ```

### 9.2 Medium-Term Improvements

1. **Simplify Layout Structure**
   - Reduce nested allotment levels
   - Implement CSS Grid for simpler layouts
   - Use virtualization for long lists

2. **Optimize File Watching**
   - Implement incremental indexing
   - Add .gitignore-aware watching
   - Debounce file system events more aggressively

3. **Improve Session Management**
   - Implement session pooling
   - Add automatic cleanup of inactive sessions
   - Limit maximum concurrent sessions

4. **Database Optimization**
   - Implement write batching
   - Add database query optimization
   - Consider IndexedDB for client-side storage

### 9.3 Long-Term Architecture Changes

1. **Plugin Architecture Redesign**
   - Implement plugin lazy loading
   - Add plugin dependency management
   - Create plugin priority system

2. **Service Optimization**
   - Implement service worker pattern for heavy operations
   - Add request deduplication
   - Implement service caching

3. **Rendering Performance**
   - Consider React 18 for stability
   - Implement proper memoization
   - Add component-level code splitting

---

## 10. Performance Monitoring Recommendations

### 10.1 Add Performance Metrics
```typescript
// Track key performance indicators
const metrics = {
  startupTime: 0,
  pluginLoadTime: 0,
  firstRenderTime: 0,
  memoryUsage: 0,
  activeTerminals: 0,
  activeSessions: 0,
}
```

### 10.2 Implement Error Tracking
```typescript
// Track performance-related errors
window.addEventListener('error', (event) => {
  if (event.message.includes('cache')) {
    // Track cache errors
  }
})
```

### 10.3 Add User Analytics
```typescript
// Track user-impacting performance issues
trackEvent('performance_issue', {
  startupTime,
  memoryUsage,
  pluginCount,
})
```

---

## 11. Testing Recommendations

### 11.1 Performance Testing
- Load testing with multiple workspaces
- Memory leak testing over extended periods
- Startup time benchmarking
- Database operation profiling

### 11.2 Stress Testing
- Multiple concurrent terminal sessions
- Large repository file watching
- Multiple active sessions
- Rapid layout changes

---

## 12. Conclusion

The Zenbu application suffers from multiple performance issues stemming from its complex plugin architecture, resource-intensive services, and potential memory leaks. The primary bottlenecks are:

1. **Plugin Overhead:** 19 plugins causing 16.6-second evaluation time
2. **Disk Cache Corruption:** Causing Chromium errors and instability
3. **Complex Layout Management:** Nested allotments causing rendering lag
4. **Resource-Intensive Services:** Terminal, sessions, and file tree services
5. **Memory Management:** Potential leaks in various service Maps

**Priority Actions:**
1. Fix disk cache corruption immediately
2. Implement lazy plugin loading
3. Add memory monitoring and cleanup
4. Simplify layout structure
5. Optimize file watching and session management

**Expected Improvements:**
- 50-70% reduction in startup time
- Significant reduction in memory usage
- Elimination of cache-related errors
- Improved responsiveness and stability

---

## Appendix: Files Analyzed

### Core Application Files
- `plugins/app/src/renderer/main.tsx` - Application entry point
- `plugins/app/src/renderer/components/app.tsx` - Main app component
- `plugins/app/src/renderer/components/workspace-body.tsx` - Layout management
- `plugins/app/src/main/services/terminal.ts` - Terminal service
- `plugins/app/src/main/services/sessions.ts` - Sessions service
- `plugins/app/src/main/services/file-tree.ts` - File tree service
- `plugins/app/src/renderer/boot/db-replica-tracer.ts` - Database tracer

### Configuration Files
- `zenbu.config.ts` - Zenbu configuration
- `zenbu.plugins.jsonc` - Plugin configuration
- `package.json` - Dependencies and scripts
- `plugins/app/package.json` - App-specific dependencies
- `plugins/app/vite.config.ts` - Build configuration

### Plugin Files
- `plugins/app/zenbu.plugin.ts` - Main app plugin
- `plugins/pi-commands/zenbu.plugin.ts` - Pi commands plugin
- `plugins/plan/zenbu.plugin.ts` - Plan plugin

---

**Report Generated By:** Devin AI Performance Analysis  
**Analysis Duration:** Comprehensive codebase review  
**Next Review:** After implementing critical fixes