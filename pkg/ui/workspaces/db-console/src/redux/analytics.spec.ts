// Copyright 2018 The Cockroach Authors.
//
// Use of this software is governed by the Business Source License
// included in the file licenses/BSL.txt.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0, included in the file
// licenses/APL.txt.

import * as sinon from "sinon";

import Analytics from "analytics-node";
import { Location, createLocation, createHashHistory } from "history";
import _ from "lodash";
import { Store } from "redux";

import { history } from "src/redux/history";
import { AnalyticsSync, defaultRedactions } from "./analytics";
import { clusterReducerObj, nodesReducerObj } from "./apiReducers";
import { AdminUIState, createAdminUIStore } from "./state";

import * as protos from "src/js/protos";

const sandbox = sinon.createSandbox();

describe("analytics listener", function () {
  const clusterID = "a49f0ced-7ada-4135-af37-8acf6b548df0";
  const setClusterData = (
    store: Store<AdminUIState>,
    enabled = true,
    enterprise = true,
  ) => {
    store.dispatch(
      clusterReducerObj.receiveData(
        new protos.cockroach.server.serverpb.ClusterResponse({
          cluster_id: clusterID,
          reporting_enabled: enabled,
          enterprise_enabled: enterprise,
        }),
      ),
    );
  };

  describe("page method", function () {
    let store: Store<AdminUIState>;
    let analytics: Analytics;
    let pageSpy: sinon.SinonSpy;

    beforeEach(function () {
      store = createAdminUIStore(createHashHistory());
      pageSpy = sandbox.spy();

      // Analytics is a completely fake object, we don't want to call
      // segment if an unexpected method is called.
      analytics = {
        page: pageSpy,
      } as any;
    });

    afterEach(() => {
      sandbox.reset();
    });

    it("does nothing if cluster info is not available", function () {
      const sync = new AnalyticsSync(analytics, store, []);

      sync.page({
        pathname: "/test/path",
      } as Location);

      expect(pageSpy.notCalled).toBe(true);
    });

    it("does nothing if reporting is not explicitly enabled", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setClusterData(store, false);

      sync.page({
        pathname: "/test/path",
      } as Location);

      expect(pageSpy.notCalled).toBe(true);
    });

    it("correctly calls segment on a page call", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setClusterData(store);

      sync.page({
        pathname: "/test/path",
      } as Location);

      expect(pageSpy.calledOnce).toBe(true);
      expect(pageSpy.args[0][0]).toEqual({
        userId: clusterID,
        name: "/test/path",
        properties: {
          path: "/test/path",
          search: "",
        },
      });
    });

    it("correctly queues calls before cluster ID is available", function () {
      const sync = new AnalyticsSync(analytics, store, []);

      sync.page({
        pathname: "/test/path",
      } as Location);

      setClusterData(store);
      expect(pageSpy.notCalled).toBe(true);

      sync.page({
        pathname: "/test/path/2",
      } as Location);

      expect(pageSpy.callCount).toBe(2);
      expect(pageSpy.args[0][0]).toEqual({
        userId: clusterID,
        name: "/test/path",
        properties: {
          path: "/test/path",
          search: "",
        },
      });
      expect(pageSpy.args[1][0]).toEqual({
        userId: clusterID,
        name: "/test/path/2",
        properties: {
          path: "/test/path/2",
          search: "",
        },
      });
    });

    it("correctly applies redaction to matched paths", function () {
      setClusterData(store);
      const sync = new AnalyticsSync(analytics, store, [
        {
          match: RegExp("/test/.*/path"),
          replace: "/test/[redacted]/path",
        },
      ]);

      sync.page({
        pathname: "/test/username/path",
      } as Location);

      expect(pageSpy.calledOnce).toBe(true);
      expect(pageSpy.args[0][0]).toEqual({
        userId: clusterID,
        name: "/test/[redacted]/path",
        properties: {
          path: "/test/[redacted]/path",
          search: "",
        },
      });
    });

    function testRedaction(title: string, input: string, expected: string) {
      return { title, input, expected };
    }

    [
      testRedaction(
        "old database URL (redirect)",
        "/databases/database/foobar/table/baz",
        "/databases/database/[db]/table/[tbl]",
      ),
      testRedaction(
        "database URL (redirect)",
        "/database/foobar",
        "/database/[db]",
      ),
      testRedaction(
        "database tables URL",
        "/database/foobar/tables",
        "/database/[db]/tables",
      ),
      testRedaction(
        "database grants URL",
        "/database/foobar/grants",
        "/database/[db]/grants",
      ),
      testRedaction(
        "database table URL (redirect)",
        "/database/foobar/table",
        "/database/[db]/table",
      ),
      testRedaction(
        "database table URL",
        "/database/foobar/table/baz",
        "/database/[db]/table/[tbl]",
      ),
      testRedaction("clusterviz map root", "/overview/map/", "/overview/map/"),
      testRedaction(
        "clusterviz map single locality",
        "/overview/map/datacenter=us-west-1",
        "/overview/map/[locality]",
      ),
      testRedaction(
        "clusterviz map multiple localities",
        "/overview/map/datacenter=us-west-1/rack=1234",
        "/overview/map/[locality]/[locality]",
      ),
      testRedaction(
        "login redirect URL parameters",
        "/login?redirectTo=%2Fdatabase%2Ffoobar%2Ftable%2Fbaz",
        "/login?redirectTo=%2Fdatabase%2F%5Bdb%5D%2Ftable%2F%5Btbl%5D",
      ),
      testRedaction(
        "statement details page",
        "/statement/SELECT * FROM database.table",
        "/statement/[statement]",
      ),
    ].map(function ({ title, input, expected }) {
      it(`applies a redaction for ${title}`, function () {
        setClusterData(store);
        const sync = new AnalyticsSync(analytics, store, defaultRedactions);
        const expectedLocation = createLocation(expected);

        sync.page(createLocation(input));

        expect(pageSpy.calledOnce).toBe(true);

        const actualArgs = pageSpy.args[0][0];
        const expectedArgs = {
          userId: clusterID,
          name: expectedLocation.pathname,
          properties: {
            path: expectedLocation.pathname,
            search: expectedLocation.search,
          },
        };
        expect(actualArgs).toEqual(expectedArgs);
      });
    });
  });

  describe("identify method", function () {
    let store: Store<AdminUIState>;
    let analytics: Analytics;
    let identifySpy: sinon.SinonSpy;

    beforeEach(function () {
      store = createAdminUIStore(createHashHistory());
      identifySpy = sandbox.spy();

      // Analytics is a completely fake object, we don't want to call
      // segment if an unexpected method is called.
      analytics = {
        identify: identifySpy,
      } as any;
    });

    afterEach(() => {
      sandbox.reset();
    });

    const setVersionData = function () {
      store.dispatch(
        nodesReducerObj.receiveData([
          {
            build_info: {
              tag: "0.1",
            },
          },
        ]),
      );
    };

    it("does nothing if cluster info is not available", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setVersionData();

      sync.identify();

      expect(identifySpy.notCalled).toBe(true);
    });

    it("does nothing if version info is not available", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setClusterData(store, true, true);

      sync.identify();

      expect(identifySpy.notCalled).toBe(true);
    });

    it("does nothing if reporting is not explicitly enabled", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setClusterData(store, false, true);
      setVersionData();

      sync.identify();

      expect(identifySpy.notCalled).toBe(true);
    });

    it("sends the correct value of clusterID, version and enterprise", function () {
      setVersionData();

      _.each([false, true], enterpriseSetting => {
        sandbox.reset();
        setClusterData(store, true, enterpriseSetting);
        const sync = new AnalyticsSync(analytics, store, []);
        sync.identify();

        expect(identifySpy.calledOnce).toBe(true);
        expect(identifySpy.args[0][0]).toEqual({
          userId: clusterID,
          traits: {
            version: "0.1",
            userAgent: window.navigator.userAgent,
            enterprise: enterpriseSetting,
          },
        });
      });
    });

    it("only reports once", function () {
      const sync = new AnalyticsSync(analytics, store, []);
      setClusterData(store, true, true);
      setVersionData();

      sync.identify();
      sync.identify();

      expect(identifySpy.calledOnce).toBe(true);
    });
  });

  describe("track method", function () {
    const store: Store<AdminUIState> = createAdminUIStore(createHashHistory());
    let analytics: Analytics;
    let trackSpy: sinon.SinonSpy;

    beforeEach(() => {
      trackSpy = sandbox.spy();

      // Analytics is a completely fake object, we don't want to call
      // segment if an unexpected method is called.
      analytics = {
        track: trackSpy,
      } as any;
    });

    afterEach(() => {
      sandbox.reset();
    });

    it("does nothing if cluster info is not available", () => {
      const sync = new AnalyticsSync(analytics, store, []);

      sync.track({
        event: "test",
      });

      expect(trackSpy.notCalled).toBe(true);
    });

    it("add userId to track calls using the cluster_id", () => {
      setClusterData(store);
      const sync = new AnalyticsSync(analytics, store, []);

      sync.track({
        event: "test",
      });

      const expected = {
        userId: clusterID,
        properties: {
          pagePath: "/",
        },
        event: "test",
      };
      const message = trackSpy.args[0][0];

      expect(trackSpy.calledOnce).toBe(true);
      expect(message).toEqual(expected);
    });

    it("add the page path to properties", () => {
      setClusterData(store);
      const sync = new AnalyticsSync(analytics, store, []);
      const testPagePath = "/test/page/path";

      history.push(testPagePath);

      sync.track({
        event: "test",
        properties: {
          testProp: "test",
        },
      });

      const expected = {
        userId: clusterID,
        properties: {
          pagePath: testPagePath,
          testProp: "test",
        },
        event: "test",
      };
      const message = trackSpy.args[0][0];

      expect(trackSpy.calledOnce).toBe(true);
      expect(message).toEqual(expected);
    });
  });
});
