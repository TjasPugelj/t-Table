import requests

url = "https://sc-celje.webuntis.com/WebUntis/api/rest/view/v1/timetable/entries"

params = {
    "start": "2026-09-01",
    "end": "2026-09-05",
    "format": 5,
    "resourceType": "CLASS",
    "resources": 2960,
    "periodTypes": "",
    "timetableType": "STANDARD",
    "layout": "START_TIME"
}

headers = {
    "Anonymous-School": "sc-celje",
    "Accept": "application/json"
}

r = requests.get(url, params=params, headers=headers)
data = r.json()

PERIODS = [
    ("07:10", "07:55"),
    ("08:00", "08:45"),
    ("08:50", "09:35"),
    ("09:40", "10:25"),
    ("10:30", "11:15"),
    ("11:20", "12:05"),
    ("12:10", "12:55"),
    ("13:00", "13:45"),
    ("13:50", "14:35"),
]

def format_entry(entry):
    status = entry["status"]
    subject = entry["position2"][0]["current"]["displayName"] if entry["position2"] else "?"
    teacher = entry["position1"][0]["current"]["displayName"] if entry["position1"] else "?"
    room = entry["position3"][0]["current"]["displayName"] if entry["position3"] else "?"
    flag = " [X]" if status == "CANCELLED" else ""
    return f"{subject:<6} {teacher:<18} {room}{flag}"

for day in data["days"]:
    print(f"\n=== {day['date']} ===")

    for i, (pstart, pend) in enumerate(PERIODS, start=1):
        # entries active in this specific period
        active = [e for e in day["gridEntries"]
                  if e["duration"]["start"][11:16] <= pstart
                  and e["duration"]["end"][11:16] >= pend]

        if not active:
            print(f"{i}. {pstart}-{pend}  break")
            continue

        groups = sorted(set(e["layoutGroup"] for e in active))

        if len(groups) == 1:
            # not split this period — just print it directly
            line = "   |   ".join(format_entry(e) for e in active)
        else:
            cols = []
            for g in groups:
                match = next((e for e in active if e["layoutGroup"] == g), None)
                cols.append(format_entry(match) if match else "break")
            line = "   |   ".join(cols)

        print(f"{i}. {pstart}-{pend}  {line}")