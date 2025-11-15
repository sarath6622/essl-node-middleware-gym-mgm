# Bug Fix: Real-time Event Handling

## Issues Fixed

### 1. Invalid Attendance Events
**Problem:** Device was sending attendance data with `user_id` (snake_case) but code expected `userId` (camelCase), causing all events to be rejected.

**Error:**
```
⚠️ Invalid attendance event - no userId provided
{
  "sn": 63,
  "user_id": "0002",  // <-- snake_case
  "record_time": "...",
  "type": 1,
  "state": 0,
  "ip": "192.168.1.14"
}
```

**Solution:** Updated `processAndSaveRecord()` to handle both formats:
```javascript
// Handle both userId and user_id (device sends user_id in snake_case)
const userId = rawRecord.userId ?? rawRecord.user_id;
```

Also handles `record_time` vs `recordTime`:
```javascript
const timestamp = rawRecord.timestamp || rawRecord.recordTime || rawRecord.record_time || now.toISOString();
```

**File:** [services/deviceService.js:30-43](services/deviceService.js#L30-L43)

---

### 2. False "No Real-time Events" Warnings
**Problem:** Failed fingerprint scans and device heartbeats didn't update the "last event time", causing false warnings:

```
⚠️ No real-time events in 40s. Using polling as backup (failure 2/3)
```

This triggered even though the device was sending real-time data (just not valid attendance records).

**Solution:** Update `lastRealtimeEventTime` for ALL events from the device:
```javascript
// Update last event time for ALL events (including failed scans, heartbeats, etc.)
lastRealtimeEventTime = Date.now();
realtimeFailureCount = 0; // Reset on any event
```

**File:** [services/deviceService.js:248-269](services/deviceService.js#L248-L269)

---

## Behavior Changes

### Before
- ❌ All attendance events rejected (wrong field name)
- ❌ False warnings every 30-40 seconds
- ❌ Unnecessary polling triggered

### After
- ✅ Attendance events processed correctly
- ✅ Real-time heartbeats/failed scans keep connection alive
- ✅ No false warnings
- ✅ Polling only activates when truly needed

---

## Testing

The fix handles these scenarios:

1. **Valid attendance events:**
   ```javascript
   { user_id: "0002", record_time: "..." } // ✅ Now works
   { userId: 123, timestamp: "..." }        // ✅ Still works
   ```

2. **Failed fingerprint scans:**
   - Device sends event data but without valid user
   - Still updates `lastRealtimeEventTime` to prevent false warnings
   - Doesn't create attendance record (as expected)

3. **Device heartbeats:**
   - Keep connection alive
   - Prevent false "no events" warnings
   - Don't trigger unnecessary polling

---

## Files Modified

1. `services/deviceService.js`
   - Line 32: Handle `record_time` field
   - Line 35: Handle both `userId` and `user_id` fields
   - Line 254-255: Update event time for ALL events
   - Line 258: Check for either field name

---

## Related to Performance Optimizations

This fix ensures the **Smart Polling** optimization works correctly:
- Real-time events (even non-attendance) prove the connection is alive
- Polling only activates when the device truly stops sending events
- Prevents wasted device queries

---

## Summary

✅ Fixed field name mismatch (`user_id` vs `userId`)
✅ Fixed false "no real-time events" warnings
✅ Smart polling now works as intended
✅ All device events count toward real-time health check

**Result:** System correctly processes all attendance events and accurately detects when real-time fails.
