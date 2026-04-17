sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"routes/routes/test/integration/pages/RouteDirectionsList",
	"routes/routes/test/integration/pages/RouteDirectionsObjectPage",
	"routes/routes/test/integration/pages/RouteStepsObjectPage"
], function (JourneyRunner, RouteDirectionsList, RouteDirectionsObjectPage, RouteStepsObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('routes/routes') + '/test/flp.html#app-preview',
        pages: {
			onTheRouteDirectionsList: RouteDirectionsList,
			onTheRouteDirectionsObjectPage: RouteDirectionsObjectPage,
			onTheRouteStepsObjectPage: RouteStepsObjectPage
        },
        async: true
    });

    return runner;
});

