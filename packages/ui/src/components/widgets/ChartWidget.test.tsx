// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartWidget } from './ChartWidget';

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ChartWidget', () => {
  it('renders bar chart with data', () => {
    const container = render(
      <ChartWidget
        title="Sales"
        data={{
          type: 'bar',
          data: [
            { label: 'Q1', value: 100 },
            { label: 'Q2', value: 200 },
            { label: 'Q3', value: 150 },
          ],
          title: 'Sales', // title must be inside data for ChartRenderer
        }}
      />
    );

    // Title is rendered by WidgetShell via ChartRenderer's deconstruction of data.title
    expect(container.textContent).toContain('Sales');
    expect(container.textContent).toContain('Q1');
    expect(container.textContent).toContain('100');
    expect(container.textContent).toContain('200');
    expect(container.textContent).toContain('150');
  });

  it('renders pie chart with data', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'pie',
          data: [
            { label: 'A', value: 30 },
            { label: 'B', value: 70 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');
    expect(container.textContent).toContain('30.0%');
    expect(container.textContent).toContain('70.0%');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders donut chart with data', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'donut',
          data: [
            { label: 'X', value: 40 },
            { label: 'Y', value: 60 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('X');
    expect(container.textContent).toContain('Y');
    expect(container.textContent).toContain('40.0%');
    expect(container.textContent).toContain('60.0%');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders line chart with data', () => {
    const container = render(
      <ChartWidget
        title="Line Chart"
        data={{
          type: 'line',
          data: [
            { label: 'Jan', value: 10 },
            { label: 'Feb', value: 20 },
            { label: 'Mar', value: 15 },
          ],
          title: 'Line Chart', // title must be in data for ChartRenderer
        }}
      />
    );

    // Line chart renders an SVG
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).toContain('Line Chart');
  });

  it('renders area chart as bar chart fallback', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'area',
          data: [
            { label: 'Item 1', value: 50 },
            { label: 'Item 2', value: 75 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('Item 1');
    expect(container.textContent).toContain('50');
    expect(container.textContent).toContain('75');
  });

  it('renders scatter chart as bar chart fallback', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'scatter',
          data: [
            { label: 'Point 1', value: 30 },
            { label: 'Point 2', value: 60 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('Point 1');
    expect(container.textContent).toContain('30');
    expect(container.textContent).toContain('60');
  });

  it('shows empty state when data array is empty', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'bar',
          data: [],
        }}
      />
    );

    expect(container.textContent).toContain('No chart data provided');
    // Should show a warning tone
    expect(container.textContent).toContain('Chart');
  });

  it('shows empty state when data is not chart data shape', () => {
    const container = render(<ChartWidget data={{ someKey: 'no chart info' }} />);

    expect(container.textContent).toContain('No chart data provided');
  });

  it('uses title from data when title prop is not provided', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'bar',
          data: [{ label: 'A', value: 1 }],
          title: 'Data Title',
        }}
      />
    );

    expect(container.textContent).toContain('Data Title');
  });

  it('shows PieChart total=0 returning null', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'pie',
          data: [{ label: 'Zero', value: 0 }],
        }}
      />
    );

    // When total is 0, PieChart returns null — we should still see the WidgetShell
    expect(container.querySelector('section')).toBeTruthy();
  });

  it('normalizes flat data array', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'bar',
          data: [10, 20, 30],
        }}
      />
    );

    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('20');
    expect(container.textContent).toContain('30');
  });

  it('uses xKey for label extraction', () => {
    const container = render(
      <ChartWidget
        data={{
          type: 'bar',
          xKey: 'name',
          data: [
            { name: 'Alpha', value: 100 },
            { name: 'Beta', value: 200 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Beta');
  });
});
