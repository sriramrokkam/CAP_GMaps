sap.ui.define(['sap/fe/test/ObjectPage'], function(ObjectPage) {
    'use strict';

    var CustomPageDefinitions = {
        actions: {},
        assertions: {}
    };

    return new ObjectPage(
        {
            appId: 'routes.routes',
            componentId: 'RouteStepsObjectPage',
            contextPath: '/RouteDirections/steps'
        },
        CustomPageDefinitions
    );
});