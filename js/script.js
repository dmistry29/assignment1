/* Chasing Comfortable Weather — D3 v7.
 * Shared state connects the brush, filters, ranking, and station detail.
 * Empty CSV fields remain null (unary + alone would turn them into zero).
 */
const stationChoices = [
    ['BALTIMORE WASH INTL AP', 'MD', 'Baltimore', 'East'],
    ['BOSTON LOGAN INTL AP', 'MA', 'Boston', 'East'],
    ['ATLANTA HARTSFIELD INTL AP', 'GA', 'Atlanta', 'East'],
    ['MIAMI INTL AP', 'FL', 'Miami', 'East'],
    ['CHICAGO OHARE INTL AP', 'IL', 'Chicago', 'Central'],
    ['DALLAS FT WORTH AP', 'TX', 'Dallas–Fort Worth', 'Central'],
    ['DENVER INTL AP', 'CO', 'Denver', 'Central'],
    ['PHOENIX SKY HARBOR INTL AP', 'AZ', 'Phoenix', 'West'],
    ['SAN DIEGO LINDBERGH FLD', 'CA', 'San Diego', 'West'],
    ['SAN FRANCISCO INTL AP', 'CA', 'San Francisco', 'West'],
    ['PORTLAND INTL AP', 'OR', 'Portland', 'West'],
    ['SEATTLE TACOMA INTL AP', 'WA', 'Seattle', 'West']
];
const parseDate = d3.utcParse('%Y%m%d');
const iso = d3.utcFormat('%Y-%m-%d');
const prettyDate = d3.utcFormat('%b %-d');
const fullDate = d3.utcFormat('%B %-d, %Y');
const firstDay = new Date(Date.UTC(2017, 0, 1));
const lastDay = new Date(Date.UTC(2017, 8, 21));
const days = d3.utcDay.range(firstDay, d3.utcDay.offset(lastDay, 1));
const state = {
    min: 65, max: 80, rain: 0.05, region: 'All', start: firstDay, end: lastDay, selected: null
};
const color = d3.scaleLinear()
    .domain([0, 30, 60, 90, 120])
    .range(['#506b97', '#95bed0', '#e8eac0', '#edba78', '#c36b52'])
    .clamp(true);
const heat = {
    width: 1200, left: 155, right: 12, top: 90, row: 28
};
const x = d3.scaleUtc()
    .domain([firstDay, d3.utcDay.offset(lastDay, 1)])
    .range([heat.left, heat.width - heat.right]);
let stations = [], heatSvg, brush, brushGroup;
const tooltip = d3.select('#tooltip');

function number(value) {
    return value.trim() === '' || !Number.isFinite(+value) ? null : +value;
}

function temperature(value) {
    const n = number(value);
    return n !== null && n >= -80 && n <= 140 ? n : null;
}

function valid(d) {
    return d && d.high !== null && d.rain !== null;
}

function comfortable(d) {
    return valid(d) && d.high >= state.min && d.high <= state.max && d.rain <= state.rain;
}

function inWindow(d) {
    return d.date >= state.start && d.date <= state.end;
}

function visibleStations() {
    return stations.filter(s => state.region === 'All' || s.region === state.region);
}

function showTip(event, html) {
    tooltip.html(html)
        .attr('hidden', null);
    const box = tooltip.node().getBoundingClientRect();
    tooltip.style('left', Math.max(8, Math.min(event.clientX + 14, window.innerWidth - box.width - 8)) + 'px')
        .style('top', Math.max(8, Math.min(event.clientY + 14, window.innerHeight - box.height - 8)) + 'px');
}

function hideTip() {
    tooltip.attr('hidden', true);
}

function dayTip(event, d, s) {
    showTip(event, `<strong>${s.label} · ${prettyDate(d.date)}</strong><br>Daily high: ${d.high === null ? 'Unavailable' : d.high.toFixed(1) + '°F'}<br>Daily low: ${d.low === null ? 'Unavailable' : d.low.toFixed(1) + '°F'}<br>Precipitation: ${d.rain === null ? 'Unavailable' : d.rain.toFixed(2) + ' in'}<br><span class="tip-status">${!valid(d) ? 'Missing / excluded measurement' : comfortable(d) ? '✓ Meets your preferences' : 'Outside your preferences'}</span>`);
}

async function init() {
    try {
        // Return null for stations outside this focused subset, reducing retained data.
        const rows = await d3.csv('data/weather.csv', raw => {
            const choice = stationChoices.find(s => s[0] === raw.station && s[1] === raw.state);
            if (!choice)
                return null;
            const date = parseDate(raw.date);
            if (!date || date < firstDay || date > lastDay)
                return null;
            const low = temperature(raw.TMIN);
            let high = temperature(raw.TMAX);
            if (high !== null && low !== null && high < low)
                high = null;
            const rain = number(raw.PRCP);
            return {
                id: [raw.station, raw.state, raw.latitude, raw.longitude].join('|'), choice, date, low, high, rain: rain !== null && rain >= 0 ? rain : null
            };
        });
        stations = Array.from(d3.group(rows, d => d.id), ([id, records]) => {
            const choice = records[0].choice;
            const byDate = new Map(records.map(d => [iso(d.date), d]));
            return {
                id, name: choice[0], state: choice[1], label: choice[2], region: choice[3], days: days.map(date => byDate.get(iso(date)) || { date, high: null, low: null, rain: null })
            };
        }).sort((a, b) => stationChoices.findIndex(s => s[0] === a.name) - stationChoices.findIndex(s => s[0] === b.name));
        if (!stations.length)
            throw new Error('No matching stations were found.');
        state.selected = stations[0].id;
        d3.select('#explorer')
            .attr('hidden', null);
        d3.select('#status')
            .text(`${stations.length} airport stations · ${rows.length.toLocaleString()} daily observations · Choose your kind of comfortable.`);
        setupHeatmap();
        setupControls();
        update();
    } catch (error) {
        console.error(error);
        d3.select('#status')
            .text('Unable to load weather data. Open this folder through a local web server (such as VS Code Live Server) and check that data/weather.csv is present.');
    }
}

function setupHeatmap() {
    heatSvg = d3.select('#heatmap')
        .append('svg')
        .attr('role', 'img')
        .attr('aria-label', 'Daily high temperature heatmap with linked date brush');
    heatSvg.append('text')
        .attr('x', heat.left - 15)
        .attr('y', 23)
        .attr('text-anchor', 'end')
        .text('SELECT DATES');
    heatSvg.append('rect')
        .attr('x', heat.left)
        .attr('y', 8)
        .attr('width', x.range()[1] - heat.left)
        .attr('height', 24)
        .attr('rx', 4)
        .attr('fill', '#eef3ed');
    heatSvg.append('g')
        .attr('transform', 'translate(0,35)')
        .call(d3.axisBottom(x)
            .ticks(d3.utcMonth.every(1))
            .tickFormat(d3.utcFormat('%b'))
            .tickSize(4));
    brush = d3.brushX()
        .extent([[heat.left, 8], [x.range()[1], 32]])
        .on('brush end', event => {
            if (!event.sourceEvent)
                return;
            if (event.selection) {
                const [a, b] = event.selection;
                state.start = d3.utcDay.floor(x.invert(a));
                state.end = d3.utcDay.floor(x.invert(Math.max(a, b - 0.01)));
                state.start = new Date(Math.max(+firstDay, Math.min(+lastDay, +state.start)));
                state.end = new Date(Math.max(+state.start, Math.min(+lastDay, +state.end)));
            } else {
                state.start = firstDay;
                state.end = lastDay;
            }
            update();
        });
    brushGroup = heatSvg.append('g')
        .attr('class', 'brush')
        .call(brush);
    heatSvg.append('g')
        .attr('class', 'rows');
}

function syncBrush() {
    brushGroup.call(brush.move, [x(state.start), x(d3.utcDay.offset(state.end, 1))]);
}

function setupControls() {
    d3.selectAll('#min-temp,#max-temp,#rain')
        .on('input', function() {
            state.min = +d3.select('#min-temp')
                .property('value');
            state.max = +d3.select('#max-temp')
                .property('value');
            state.rain = +d3.select('#rain')
                .property('value');
            if (state.min > state.max) {
                if (this.id === 'min-temp')
                    state.max = state.min;
                else
                    state.min = state.max;
            }
            update();
        });
    d3.select('#region')
        .on('change', function() {
            state.region = this.value;
            update();
        });
    d3.selectAll('#start-date,#end-date')
        .on('change', function() {
            const date = d3.utcParse('%Y-%m-%d')(this.value);
            if (!date || date < firstDay || date > lastDay) {
                update();
                return;
            }
            if (this.id === 'start-date') {
                state.start = date;
                if (state.end < date)
                    state.end = date;
            } else {
                state.end = date;
                if (state.start > date)
                    state.start = date;
            }
            syncBrush();
            update();
        });
    d3.select('#full-range')
        .on('click', () => {
            state.start = firstDay;
            state.end = lastDay;
            syncBrush();
            update();
        });
    d3.select('#reset')
        .on('click', () => {
            Object.assign(state, {
                min: 65, max: 80, rain: 0.05, region: 'All', start: firstDay, end: lastDay, selected: stations[0].id
            });
            syncBrush();
            update();
        });
    syncBrush();
}

function summarize(s) {
    const subset = s.days.filter(inWindow), available = subset.filter(valid), good = available.filter(comfortable);
    let streak = 0, best = 0, streakStart = null, bestStart = null, bestEnd = null;
    subset.forEach(d => {
        if (comfortable(d)) {
            if (!streak)
                streakStart = d.date;
            streak++;
            if (streak > best) {
                best = streak;
                bestStart = streakStart;
                bestEnd = d.date;
            }
        } else
            streak = 0;
    });
    return {
        ...s, count: good.length, valid: available.length, percent: available.length ? good.length / available.length : null, streak: best, streakStart: bestStart, streakEnd: bestEnd
    };
}

function selectStation(s) {
    state.selected = s.id;
    hideTip();
    update();
}

function update() {
    hideTip();
    const shown = visibleStations();
    if (!shown.some(s => s.id === state.selected))
        state.selected = shown[0]?.id;
    const summaries = shown.map(summarize).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.label.localeCompare(b.label));
    d3.select('#min-temp')
        .property('value', state.min);
    d3.select('#max-temp')
        .property('value', state.max);
    d3.select('#rain')
        .property('value', state.rain);
    d3.select('#region')
        .property('value', state.region);
    d3.select('#min-label')
        .text(`${state.min}°F`);
    d3.select('#max-label')
        .text(`${state.max}°F`);
    d3.select('#rain-label')
        .text(`${state.rain.toFixed(2)} in`);
    d3.select('#start-date')
        .property('value', iso(state.start));
    d3.select('#end-date')
        .property('value', iso(state.end));
    d3.select('#window-stat')
        .text(`${prettyDate(state.start)} – ${prettyDate(state.end)}`);
    d3.select('#days-stat')
        .text(`${d3.utcDay.count(state.start, state.end) + 1} days in 2017`);
    const winner = summaries.find(s => s.percent !== null);
    d3.select('#best-stat')
        .text(winner && winner.count ? winner.label : 'No matching days');
    d3.select('#best-note')
        .text(winner ? `${d3.format('.0%')(winner.percent)} comfortable · ${winner.count} of ${winner.valid} valid days` : 'No valid observations in this window');
    const longest = d3.greatest(summaries, s => s.streak);
    d3.select('#streak-stat')
        .text(longest?.streak ? `${longest.streak} consecutive days` : 'No streak yet');
    d3.select('#streak-note')
        .text(longest?.streak ? `${longest.label} · ${prettyDate(longest.streakStart)} – ${prettyDate(longest.streakEnd)}` : 'Try widening your preferences');
    drawHeatmap(shown);
    drawRanking(summaries);
    drawDetail(shown.find(s => s.id === state.selected));
}

function drawHeatmap(shown) {
    heatSvg.attr('viewBox', `0 0 ${heat.width} ${heat.top + shown.length * heat.row + 6}`);
    const groups = heatSvg.select('.rows').selectAll('.station-row')
        .data(shown, s => s.id)
        .join('g')
        .attr('class', 'station-row')
        .attr('transform', (s, i) => `translate(0,${heat.top + i * heat.row})`);
    groups.each(function(s) {
        const row = d3.select(this);
        row.selectAll('.station-label')
            .data([s])
            .join('text')
            .attr('class', `station-label${s.id === state.selected ? ' selected' : ''}`)
            .attr('x', heat.left - 15)
            .attr('y', 14)
            .attr('text-anchor', 'end')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', `Inspect ${s.label}`)
            .text(s.label)
            .on('click', () => selectStation(s))
            .on('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectStation(s);
                }
            });
        row.selectAll('.cell')
            .data(s.days, d => +d.date)
            .join('rect')
            .attr('class', 'cell')
            .attr('x', d => x(d.date))
            .attr('width', Math.max(1, x(d3.utcDay.offset(firstDay, 1)) - x(firstDay) - .6))
            .attr('height', 20)
            .attr('rx', .6)
            .attr('fill', d => valid(d) ? color(d.high) : '#edf0ee')
            .attr('opacity', d => inWindow(d) ? 1 : .18)
            .attr('stroke', d => comfortable(d) ? '#154b3c' : 'none')
            .attr('stroke-width', .9)
            .on('pointermove', (event, d) => dayTip(event, d, s))
            .on('pointerleave', hideTip)
            .on('click', () => selectStation(s));
    });
}

function drawRanking(data) {
    const w = 540, left = 135, right = 95, row = 30, h = data.length * row + 40;
    const svg = d3.select('#ranking').selectAll('svg')
        .data([null])
        .join('svg')
        .attr('viewBox', `0 0 ${w} ${h}`)
        .attr('role', 'img')
        .attr('aria-label', 'Stations ranked by percentage of comfortable days');
    const scale = d3.scaleLinear()
        .domain([0, 1])
        .range([left, w - right]);
    svg.selectAll('.rank-axis')
        .data([null])
        .join('g')
        .attr('class', 'rank-axis')
        .attr('transform', `translate(0,${h - 24})`)
        .call(d3.axisBottom(scale)
            .ticks(4)
            .tickFormat(d3.format('.0%'))
            .tickSize(0));
    const bars = svg.selectAll('.bar')
        .data(data, s => s.id)
        .join('g')
        .attr('class', 'bar')
        .attr('transform', (s, i) => `translate(0,${i * row})`)
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', s => `${s.label}: ${s.percent === null ? 'no data' : d3.format('.0%')(s.percent) + ' comfortable'}, ${s.count} of ${s.valid} valid days. Inspect station.`)
        .on('click', (event, s) => selectStation(s))
        .on('keydown', (event, s) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectStation(s);
            }
        })
        .on('pointermove', (event, s) => showTip(event, `<strong>${s.label}</strong><br>${s.count} comfortable / ${s.valid} valid days<br>${d3.utcDay.count(state.start, state.end) + 1 - s.valid} missing or excluded days`))
        .on('pointerleave', hideTip);
    bars.selectAll('.track')
        .data(s => [s])
        .join('rect')
        .attr('class', 'track')
        .attr('x', left)
        .attr('y', 3)
        .attr('width', scale(1) - left)
        .attr('height', 18)
        .attr('rx', 3)
        .attr('fill', '#edf2ec');
    bars.selectAll('.value')
        .data(s => [s])
        .join('rect')
        .attr('class', 'value')
        .attr('x', left)
        .attr('y', 3)
        .attr('width', s => scale(s.percent ?? 0) - left)
        .attr('height', 18)
        .attr('rx', 3)
        .attr('fill', s => s.id === state.selected ? '#16715b' : '#a5bdac');
    bars.selectAll('.name')
        .data(s => [s])
        .join('text')
        .attr('class', 'name')
        .attr('x', left - 12)
        .attr('y', 16)
        .attr('text-anchor', 'end')
        .style('font-weight', s => s.id === state.selected ? 700 : 400)
        .text(s => s.label);
    bars.selectAll('.percent')
        .data(s => [s])
        .join('text')
        .attr('class', 'percent')
        .attr('x', w - right + 10)
        .attr('y', 16)
        .text(s => s.percent === null ? 'No data' : `${d3.format('.0%')(s.percent)} (${s.count}/${s.valid})`);
}

function drawDetail(s) {
    if (!s)
        return;
    d3.select('#detail-title')
        .text(s.label);
    d3.select('#detail-subtitle')
        .text(`${s.name}, ${s.state} · ${prettyDate(state.start)} – ${prettyDate(state.end)}`);
    const data = s.days.filter(inWindow), w = 570, h = 260, m = { left: 42, right: 12, top: 16, bottom: 34 };
    const sx = d3.scaleUtc()
        .domain([state.start, d3.utcDay.offset(state.end, 1)])
        .range([m.left, w - m.right]);
    const highs = data.map(d => d.high).filter(v => v !== null);
    const sy = d3.scaleLinear()
        .domain([Math.min(state.min - 10, d3.min(highs) ?? state.min), Math.max(state.max + 10, d3.max(highs) ?? state.max)])
        .nice()
        .range([h - m.bottom, m.top]);
    const svg = d3.select('#detail').selectAll('svg')
        .data([null])
        .join('svg')
        .attr('viewBox', `0 0 ${w} ${h}`)
        .attr('role', 'img')
        .attr('aria-label', `${s.label} daily high temperature and preferred temperature range`);
    svg.selectAll('*').remove();
    svg.append('rect')
        .attr('x', m.left)
        .attr('y', sy(state.max))
        .attr('width', w - m.left - m.right)
        .attr('height', sy(state.min) - sy(state.max))
        .attr('fill', '#e8f1e3');
    svg.append('g')
        .attr('transform', `translate(${m.left},0)`)
        .call(d3.axisLeft(sy)
            .ticks(5)
            .tickSize(-(w - m.left - m.right))
            .tickFormat(d => `${d}°`));
    svg.append('g')
        .attr('transform', `translate(0,${h - m.bottom})`)
        .call(d3.axisBottom(sx)
            .ticks(5)
            .tickFormat(prettyDate)
            .tickSize(0));
    svg.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#78908e')
        .attr('stroke-width', 1.8)
        .attr('d', d3.line()
            .defined(d => d.high !== null)
            .x(d => sx(d.date))
            .y(d => sy(d.high)));
    svg.selectAll('.good-day')
        .data(data.filter(comfortable))
        .join('circle')
        .attr('cx', d => sx(d.date))
        .attr('cy', d => sy(d.high))
        .attr('r', 3)
        .attr('fill', '#16715b');
    if (!highs.length)
        svg.append('text')
            .attr('class', 'empty-note')
            .attr('x', w / 2)
            .attr('y', h / 2)
            .attr('text-anchor', 'middle')
            .text('No valid temperature readings in this window.');
    const cursor = svg.append('line')
        .attr('y1', m.top)
        .attr('y2', h - m.bottom)
        .attr('stroke', '#183b39')
        .attr('stroke-dasharray', '3,3')
        .attr('visibility', 'hidden');
    svg.append('rect')
        .attr('x', m.left)
        .attr('y', m.top)
        .attr('width', w - m.left - m.right)
        .attr('height', h - m.top - m.bottom)
        .attr('fill', 'transparent')
        .on('pointermove', function(event) {
            const date = sx.invert(d3.pointer(event, this)[0]);
            const i = Math.max(0, Math.min(data.length - 1, d3.bisector(d => d.date).center(data, date)));
            const d = data[i];
            cursor.attr('x1', sx(d.date))
                .attr('x2', sx(d.date))
                .attr('visibility', 'visible');
            dayTip(event, d, s);
        })
        .on('pointerleave', () => {
            cursor.attr('visibility', 'hidden');
            hideTip();
        });
}

init();
