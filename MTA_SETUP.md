# Culmina RMS — MTA Metro-North Integration
## No API key required · Live data · Darien stop 122

---

### Setup steps

#### 1. Install package
```bash
npm install gtfs-realtime-bindings
```

#### 2. Add files to repo

| File | Destination |
|---|---|
| `mta_arrivals_route.ts` | `src/app/api/mta/arrivals/route.ts` (new folder) |
| `TrainBoard.tsx` | `src/components/TrainBoard.tsx` |
| `useTrainTiming.ts` | `src/hooks/useTrainTiming.ts` |

#### 3. No environment variables needed
The MTA feed is completely open. No keys, no headers.

#### 4. Deploy
```bash
git add src/app/api/mta/arrivals/route.ts \
        src/components/TrainBoard.tsx \
        src/hooks/useTrainTiming.ts
git commit -m "feat: MTA Metro-North live arrivals at Darien"
git push && vercel --prod
```

#### 5. Test
```
GET https://culmina.kitchen/api/mta/arrivals
GET https://culmina.kitchen/api/mta/arrivals?direction=outbound&limit=3
```

---

### How to use the components

```tsx
// Full train board in WaitlistModule:
import TrainBoard from '@/components/TrainBoard'

<TrainBoard direction="outbound" limit={4} />
// Shows next 4 trains arriving from NYC at Darien

// Compact pill in host view header:
<TrainBoard compact onNextTrainMinutes={min => setNextTrain(min)} />

// Hook for waitlist timing logic:
import { useTrainTiming, trainTimingHint, shouldNotifyGuest } from '@/hooks/useTrainTiming'

const { nextOutbound, nextInbound } = useTrainTiming()

// Hint string for host display:
trainTimingHint(nextOutbound)
// → "🚆 Train in 7 min — expect 6:14 PM walk-in rush"

// Decide whether to notify a waiting guest:
shouldNotifyGuest({
  tableReadyInMinutes: 8,
  nextTrainMinutes: nextInbound?.minutesUntilArrival ?? null,
})
// → { notify: false, reason: "Only 6 min before train — suggest waiting for next train" }
```

---

### Stop IDs reference

| Stop | ID | Direction |
|---|---|---|
| Darien (parent) | 122 | Use for simple queries |
| Darien Inbound | 122_I | Morning — toward Grand Central |
| Darien Outbound | 122_E | Evening — arriving from NYC |
| Noroton Heights | 121 | One stop west (closer to NYC) |
| Rowayton | 123 | One stop east (toward New Haven) |

### Feed URL
```
https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr
```
Returns Protocol Buffers (protobuf). The `gtfs-realtime-bindings` package handles decoding.
Feed refreshes approximately every 30 seconds at the MTA end.
The API route caches for 30 seconds to avoid redundant fetches.

### Walk time note
Corretto is inside the station building. Platform → bar = ~2 minutes.
This is baked into the `tableReadyWindowMinutes` calculation in the API response.
