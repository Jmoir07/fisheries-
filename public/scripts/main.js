
// Main frontend script (ready for API / map integration)

let events = [];
let currentRequest = 0;
let selectedVessel = null;

// Download CSV button
function downloadCSV() {
    const table = document.querySelector(".table-panel .vessel-table");
    const rows = [...table.querySelectorAll("tbody tr")];

    // Ignore the placeholder row.
    const dataRows = rows.filter(row => !row.querySelector("[colspan]"));

    if (dataRows.length === 0) {
        alert("No data to download. Load the fishing data first.");
        return;
    }

    function escapeCSV(value) {
        let text = value.trim();

        // Prevent spreadsheet programs from executing text as formulas.
        if (/^[=+\-@]/.test(text)) {
            text = "'" + text;
        }

        return '"' + text.replace(/"/g, '""') + '"';
    }

    const headers = [...table.querySelectorAll("thead th")]
        .map(cell => escapeCSV(cell.textContent))
        .join(",");

    const data = dataRows.map(row =>
        [...row.querySelectorAll("td")]
            .map(cell => escapeCSV(cell.textContent))
            .join(",")
    );

    const csv = "\uFEFF" + [headers, ...data].join("\r\n");
    const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `fishing-data-${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Vessel search form logic
document.getElementById("vessel-search-form")?.addEventListener("submit", async event => {
    event.preventDefault();

    const query = document.getElementById("vessel-query").value.trim();
    const status = document.getElementById("vessel-search-status");
    const results = document.getElementById("vessel-results");

    status.textContent = "Searching...";
    results.replaceChildren();

    try {
        const response = await fetch(
            `/api/vessels/search?query=${encodeURIComponent(query)}`
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Search failed.");
        }

        const vessels = [];

        (data.entries || []).forEach(entry => {
            const records = entry.registryInfo?.length
                ? entry.registryInfo
                : entry.selfReportedInfo || [];

            records.forEach(record => {
                vessels.push({
                    name: record.shipname || "Unknown",
                    imo: record.imo || "N/A",
                    mmsi: record.ssvid || "N/A",
                    flag: record.flag || "Unknown",
                    id: entry.selfReportedInfo?.[0]?.id || null
                });
            });
        });

        showVessels(vessels);

        status.textContent = vessels.length
            ? `${vessels.length} result(s).`
            : "No vessels found.";

    } catch (error) {
        status.textContent = error.message;
    }
});

// Display vessels
function showVessels(vessels) {
    const results = document.getElementById("vessel-results");

    results.replaceChildren();

    if (!vessels.length) {
        results.textContent = "No vessels found.";
        return;
    }

    vessels.forEach(vessel => {
        const item = document.createElement("li");

        const name = document.createElement("p");
        name.textContent = vessel.name;

        const details = document.createElement("p");
        details.textContent =
            `IMO: ${vessel.imo} | MMSI: ${vessel.mmsi} | Flag: ${vessel.flag}`;

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "View activity";
        button.disabled = !vessel.id;

        button.addEventListener("click", function() {
            loadEvents(vessel);
        });

        item.append(name, details, button);
        results.appendChild(item);
    });
}

// Load all fishing events
async function loadEvents(vessel) {
    const requestId = ++currentRequest;

    events = [];
    selectedVessel = vessel;

    document.getElementById("vesselName").textContent = vessel.name;
    document.getElementById("status").textContent = "Loading events...";

    // Use the combined activity table
    const table = document.getElementById("vessel-tbody");
    table.replaceChildren();

    if (!vessel.id) {
        document.getElementById("status").textContent =
            "No vessel ID found.";
        return;
    }

    let offset = 0;

    try {
        while (true) {
            const params = new URLSearchParams({
                vesselId: vessel.id,
                startDate: "2000-01-01",
                endDate: new Date().toISOString().slice(0, 10),
                limit: "100",
                offset: String(offset)
            });

            const response = await fetch(
                `/api/vessels/events?${params.toString()}`
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Could not load events.");
            }

            // Stop if another vessel has been selected
            if (requestId !== currentRequest) return;

            const newEvents = data.entries || [];

            events.push(...newEvents);

            // Update the combined table after each batch
            showEvents();

            document.getElementById("status").textContent =
                events.length + " events loaded...";

            // Check for the next page
            const nextOffset = data.nextOffset;

            if (!newEvents.length || nextOffset == null) {
                break;
            }

            if (Number(nextOffset) <= offset) {
                throw new Error("Pagination stopped unexpectedly.");
            }

            offset = Number(nextOffset);
        }

        document.getElementById("status").textContent =
            events.length + " events retrieved.";

    } catch (error) {
        if (requestId === currentRequest) {
            document.getElementById("status").textContent =
                error.message;
        }
    }
}

// Display events, newest first
function showEvents() {
    const table = document.getElementById("vessel-tbody");

    table.replaceChildren();

    const sortedEvents = [...events].sort((a, b) => {
        return new Date(b.start) - new Date(a.start);
    });

    if (!sortedEvents.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 10;
        cell.textContent = "No fishing events found.";

        row.appendChild(cell);
        table.appendChild(row);
        return;
    }

    sortedEvents.forEach(event => {
        const row = document.createElement("tr");

        const values = [
            selectedVessel?.name || "N/A",
            selectedVessel?.mmsi || "N/A",
            selectedVessel?.flag || "N/A",
            event.gearType || event.gear_type || "N/A",
            event.type || event.eventType || "Fishing",
            event.start || "N/A",
            event.end || "N/A",
            calculateFishingHours(event.start, event.end),
            event.position?.lat ?? "N/A",
            event.position?.lon ?? "N/A"
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        table.appendChild(row);
    });
}

// Calculate fishing event duration in hours
function calculateFishingHours(start, end) {
    if (!start || !end) {
        return "N/A";
    }

    const startTime = new Date(start);
    const endTime = new Date(end);

    if (
        Number.isNaN(startTime.getTime()) ||
        Number.isNaN(endTime.getTime()) ||
        endTime < startTime
    ) {
        return "N/A";
    }

    const hours = (endTime - startTime) / (1000 * 60 * 60);

    return hours.toFixed(2);
}
