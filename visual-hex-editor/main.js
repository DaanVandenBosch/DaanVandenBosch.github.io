const file_input = document.getElementById('file');
const test_el = document.getElementById('data-hex-table');
var start_el = document.getElementById('start');
var end_el = document.getElementById('end');
var pattern_el = document.getElementById('pattern');
const canvas_el = document.getElementById('canvas');
const ctx = canvas_el.getContext('2d');
let dv;

class PatternMatcher {
    constructor(data_view, pattern) {
        this._dv = data_view;
        this._pattern = pattern;
        this._pretty_pattern = '';
        this._position = 0;
        this._parsers = [];
        this._parser_position = 0;

        const regex = /([iuf])(\d+)([bl]e)?(:\w+)?[,;]?\s*/gi;
        let delim = '';

        for (let match = regex.exec(this._pattern); match; match = regex.exec(this._pattern)) {
            const type = { i: 'Int', u: 'Uint', f: 'Float' }[match[1]];
            let size = Math.round(parseInt(match[2], 10) / 8) * 8;
            const endianness = match[3];
            const plot = match[4];
            if (type == 'Float' ? size < 32 : size > 32) size = 32;

            const parser_body = `
                const u8s = [];
                const end = Math.min(this._position + ${size / 8}, this._dv.byteLength);
                for(let i = this._position; i < end; ++i) u8s.push(this._dv.getUint8(i));
                const get = this._position + ${size / 8} <= this._dv.byteLength;
                return {
                    value: get ? this._dv.get${type}${size}(this._position, ${String(endianness == 'le')}) : null,
                    u8s: u8s,
                    type: '${match[1]}',
                    size: ${size},
                    plot_x: ${String(!!plot && plot.includes('x'))},
                    plot_y: ${String(!!plot && plot.includes('y'))},
                    plot_z: ${String(!!plot && plot.includes('z'))}
                };
            `;

            this._pretty_pattern += `${delim}${match[1]}${size}${endianness || ''}${plot || ''}`
            delim = ', ';
            this._parsers.push(new Function(parser_body).bind(this));
        }
    }

    get pattern_length() {
        return this._parsers.length;
    }

    get pretty_pattern() {
        return this._pretty_pattern;
    }

    get has_next() {
        return this._position < this._dv.byteLength && this._parsers.length;
    }

    next() {
        if (this.has_next) {
            const result = this._parsers[this._parser_position % this._parsers.length]();
            this._position += result.u8s.length;
            this._parser_position += 1;
            return result;
        } else {
            return null;
        }
    }
}

function resize_canvas() {
    const vertical = window.innerWidth <= 1300;
    const container_width = canvas_el.parentNode.offsetWidth;
    const container_height = canvas_el.parentNode.offsetHeight;
    const width = Math.round(vertical ? container_width : container_width / 2);
    const height = Math.round(vertical ? window.innerHeight / 2 : container_height);

    if (canvas_el.width != width || canvas_el.height != height) {
        canvas_el.width = width;
        canvas_el.height = height;

        read_binary(false);

        setTimeout(resize_canvas, 100);
    }
}

function zero_pad(x, length) {
    let s = x.toString(16).toUpperCase();
    while (s.length < length) s = '0' + s;
    return s;
}

function match_value_to_string(result) {
    const v = result.value;

    if (v === null) {
        return '';
    } else {
        switch (result.type) {
            case 'f':
                const abs = Math.abs(v);
                return abs > 10000 ? v.toExponential(2) : v.toFixed(2);
            case 'i':
            case 'u':
                return String(v);
        }
    }
}

function match_u8s_to_string(result) {
    return result.u8s.map(u8 => zero_pad(u8.toString(16), 2)).join(' ');
}

function read_binary(hex = true) {
    let html = '';
    let start = parseInt(start_el.value) || 0;
    if (start < 0) start = dv && dv.byteLength + start;
    let end = parseInt(end_el.value) || dv && dv.byteLength || 0;
    if (end < 0) end = dv && dv.byteLength + end;
    const matcher = new PatternMatcher(dv && new DataView(dv.buffer, start, end - start), pattern_el.value);
    pattern_el.value = matcher.pretty_pattern;

    if (!dv) return;

    const x_results = [];
    let min_x = Infinity;
    let max_x = -Infinity;
    const y_results = [];
    let min_y = Infinity;
    let max_y = -Infinity;
    let offset = start;

    while (matcher.has_next) {
        const row_offset = offset;
        const row_results = [];

        for (let i = 0; i < matcher.pattern_length && matcher.has_next; ++i) {
            const result = matcher.next();
            result.offset = row_offset;
            row_results.push(result);
            const value = result.value;

            if (isFinite(value)) {
                if (result.plot_x) {
                    x_results.push(result);
                    if (value < min_x) min_x = value;
                    if (value > max_x) max_x = value;
                }

                if (result.plot_y) {
                    y_results.push(result);
                    if (value < min_y) min_y = value;
                    if (value > max_y) max_y = value;
                }
            }

            offset += result.u8s.length;
        }

        if (hex && (offset - start) / 12 < 2000) {
            const value_cells = row_results
                .map(r => `<td class="data-value">${match_value_to_string(r)}</td>`)
                .join('');
            const filler_cells = Array(matcher.pattern_length - row_results.length)
                .fill('<td></td>')
                .join('');
            const u8_cells = row_results
                .map(r => `<td class="data-u8s-hex">${match_u8s_to_string(r)}</td>`)
                .join('');
            html += `
                <tr>
                    <td>${row_offset}:</td>
                    ${value_cells}
                    ${filler_cells}
                    ${u8_cells}
                </tr>
            `;
        }
    }

    const width = max_x - min_x;
    const height = max_y - min_y;
    const width_ratio = canvas_el.width / width;
    const height_ratio = canvas_el.height / height;

    let scale;

    if (width / height > canvas_el.width / canvas_el.height) {
        scale = width_ratio;
    } else {
        scale = height_ratio;
    }

    ctx.setTransform(
        1, 0,
        0, 1,
        0, 0
    );

    ctx.clearRect(0, 0, canvas_el.width, canvas_el.height);

    ctx.setTransform(
        scale, 0,
        0, scale,
        width_ratio * -min_x, height_ratio * -min_y
    );

    const plot_len = Math.min(x_results.length, y_results.length);
    const point_size = Math.max(width, height) / 1000

    for (let i = 0; i < plot_len; ++i) {
        ctx.beginPath();
        ctx.arc(x_results[i].value, y_results[i].value, point_size, 0, 2 * Math.PI, false);
        ctx.fillStyle = `hsl(${Math.round(x_results[i].offset / dv.byteLength * 240)}, 100%, 50%)`;
        ctx.fill();
    }

    if (hex) {
        test_el.innerHTML = html;
    }
}

// Initialization

function init_parameters() {
    start_el.value = (location.search.match(/start=(-?\d+)/) || [null, 0])[1];
    end_el.value = (location.search.match(/end=(-?\d+)/) || [null, ''])[1];
    pattern_el.value = (location.search.match(/pattern=([^?&=#]+)/) || [null, 'f32:x, f32:y'])[1];
    read_binary();
}

[start_el, end_el, pattern_el].forEach(el => el.addEventListener('change', () => {
    let loc = location.pathname;
    let sep = '?';

    ['start', 'end', 'pattern'].forEach(name => {
        const v = window[name + '_el'].value.replace(/ /g, '');

        if (v) {
            loc += sep + name + '=' + v;
            sep = '&';
        }
    });

    history.pushState(null, '', loc);
    read_binary();
}));

file_input.addEventListener('change', () => {
    test_el.innerHTML = '';

    [].forEach.call(file_input.files, f => {
        const reader = new FileReader();
        reader.addEventListener("loadend", () => {
            dv = new DataView(reader.result);
            read_binary();
        });
        reader.readAsArrayBuffer(f);
    });
});

init_parameters();
resize_canvas();

window.addEventListener('popstate', init_parameters);
window.addEventListener('resize', resize_canvas);