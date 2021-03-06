'use strict';

(function() {
  angular.module('openshiftConsole').component('bindService', {
    controller: [
      '$rootScope',
      '$scope',
      '$filter',
      'APIService',
      'ApplicationsService',
      'BindingService',
      'Catalog',
      'DataService',
      'ServiceInstancesService',
      BindService
    ],
    controllerAs: 'ctrl',
    bindings: {
      target: '<',
      project: '<',
      onClose: '<',
      onBindCreated: '<',
      parameterData: '<'
    },
    templateUrl: 'views/directives/bind-service.html'
  });

  function BindService($rootScope,
                       $scope,
                       $filter,
                       APIService,
                       ApplicationsService,
                       BindingService,
                       Catalog,
                       DataService,
                       ServiceInstancesService) {
    var ctrl = this;
    var bindFormStep;
    var bindParametersStep;
    var resultsStep;
    var selectionValidityWatcher;
    var parametersValidityWatcher;
    var bindingWatch;
    var statusCondition = $filter('statusCondition');
    var enableTechPreviewFeature = $filter('enableTechPreviewFeature');
    var isMobileService = $filter('isMobileService');
    var serviceInstancesVersion = APIService.getPreferredVersion('serviceinstances');
    var serviceClassesVersion = APIService.getPreferredVersion('clusterserviceclasses');
    var servicePlansVersion = APIService.getPreferredVersion('clusterserviceplans');
    var mobileBindingProviderAnnotation = $filter('annotationName')('mobileBindingProviderId');
    var mobileBindingConsumerAnnotation = $filter('annotationName')('mobileBindingConsumerId');

    var preselectService = function(){
      var newestReady;
      var newestNotReady;
      _.each(ctrl.serviceInstances, function(instance) {
        var ready = _.get(statusCondition(instance, 'Ready'), 'status') === 'True';
        if (ready && (!newestReady || instance.metadata.creationTimestamp > newestReady.metadata.creationTimestamp)) {
          newestReady = instance;
        }
        if (!ready && (!newestNotReady || instance.metadata.creationTimestamp > newestNotReady.metadata.creationTimestamp)) {
          newestNotReady = instance;
        }
      });
      ctrl.serviceToBind = newestReady || newestNotReady;
    };

    var sortServiceInstances = function() {
      // wait till both service instances and service classes are available so
      // that the sort is stable and items dont jump around
      if (ctrl.serviceClasses && ctrl.serviceInstances && ctrl.servicePlans) {
        ctrl.serviceInstances =
          BindingService.filterBindableServiceInstances(ctrl.serviceInstances,
                                                        ctrl.serviceClasses,
                                                        ctrl.servicePlans);
        ctrl.orderedServiceInstances =
          BindingService.sortServiceInstances(ctrl.serviceInstances, ctrl.serviceClasses);

        if (!ctrl.serviceToBind) {
          preselectService();
        }
      }
    };

    var showBind = function() {
      ctrl.nextTitle = bindParametersStep.hidden ? 'Bind' : 'Next >';
      if (ctrl.podPresets && !selectionValidityWatcher) {
        selectionValidityWatcher = $scope.$watch("ctrl.selectionForm.$valid", function(isValid) {
          bindFormStep.valid = isValid;
        });
      }
    };

    var showParameters = function() {
      ctrl.nextTitle = 'Bind';
      if (!parametersValidityWatcher) {
        parametersValidityWatcher = $scope.$watch("ctrl.parametersForm.$valid", function(isValid) {
          bindParametersStep.valid = isValid;
        });
      }
    };

    var showResults = function() {
      if (selectionValidityWatcher) {
        selectionValidityWatcher();
        selectionValidityWatcher = undefined;
      }
      if (parametersValidityWatcher) {
        parametersValidityWatcher();
        parametersValidityWatcher = undefined;
      }
      ctrl.nextTitle = "Close";
      ctrl.wizardComplete = true;

      ctrl.bindService();
    };

    var loadApplications = function() {
      var context = {
        namespace: _.get(ctrl.target, 'metadata.namespace')
      };
      ApplicationsService.getApplications(context).then(function(applications) {
        ctrl.applications = applications;
        ctrl.bindType = ctrl.applications.length ? "application" : "secret-only";
      });
    };

    var loadServiceInstances = function() {
      var context = {
        namespace: _.get(ctrl.target, 'metadata.namespace')
      };

      DataService.list(serviceInstancesVersion, context).then(function(instances) {
        ctrl.serviceInstances = instances.by('metadata.name');
        sortServiceInstances();
      });

      DataService.list(serviceClassesVersion, {}).then(function (serviceClasses) {
        ctrl.serviceClasses = serviceClasses.by('metadata.name');
        sortServiceInstances();
      });

      DataService.list(servicePlansVersion, {}).then(function(plans) {
        ctrl.servicePlans = plans.by('metadata.name');
        sortServiceInstances();
      });
    };

    bindFormStep = {
      id: 'bindForm',
      label: 'Binding',
      view: 'views/directives/bind-service/bind-service-form.html',
      valid: false,
      allowClickNav: true,
      onShow: showBind
    };

    bindParametersStep = {
      id: 'bindParameters',
      label: 'Parameters',
      view: 'views/directives/bind-service/bind-parameters.html',
      hidden: true,
      allowClickNav: true,
      onShow: showParameters
    };

    resultsStep = {
      id: 'results',
      label: 'Results',
      view: 'views/directives/bind-service/results.html',
      valid: true,
      allowClickNav: false,
      onShow: showResults
    };

    var updateServiceInstance = function() {
      if (!ctrl.serviceToBind) {
        return;
      }

      ServiceInstancesService.fetchServiceClassForInstance(ctrl.serviceToBind).then(function(serviceClass) {
        ctrl.serviceClass = serviceClass;
        var servicePlanName = ServiceInstancesService.getServicePlanNameForInstance(ctrl.serviceToBind);
        DataService.get(servicePlansVersion, servicePlanName, {}).then(function(plan) {
          ctrl.plan = plan;
          ctrl.parameterSchema = _.get(ctrl.plan, 'spec.serviceBindingCreateParameterSchema');
          ctrl.parameterFormDefinition = _.get(ctrl.plan, 'spec.externalMetadata.schemas.service_binding.create.openshift_form_definition');

          bindParametersStep.hidden = !_.has(ctrl.parameterSchema, 'properties');
          ctrl.nextTitle = bindParametersStep.hidden ? 'Bind' : 'Next >';
          ctrl.hideBack = bindParametersStep.hidden;
          bindFormStep.valid = true;
        });
      });
    };

    var loadServiceClasses = function() {
      DataService.list(serviceClassesVersion, {}).then(function (serviceClasses) {
        ctrl.serviceClasses = serviceClasses.by('metadata.name');
      });
    };

    var getMobileBindingMetadata = function(svcToBind, serviceClass) {
      var consumerId = _.get(ctrl, 'parameterData.CLIENT_ID');
      var annotations = {};
      annotations[mobileBindingConsumerAnnotation] = consumerId;
      annotations[mobileBindingProviderAnnotation] = _.get(svcToBind, 'metadata.name');
      return {
        generateName: consumerId.toLowerCase() + '-' + _.get(serviceClass, 'spec.externalMetadata.serviceName').toLowerCase() + '-',
        annotations: annotations
      };      
    };

    $scope.$watch("ctrl.serviceToBind", updateServiceInstance);

    ctrl.$onInit = function() {
      ctrl.isMobileEnabled = $rootScope.AEROGEAR_MOBILE_ENABLED;
      ctrl.serviceSelection = {};
      ctrl.projectDisplayName = $filter('displayName')(ctrl.project);
      ctrl.podPresets = enableTechPreviewFeature('pod_presets');
      ctrl.parameterData = ctrl.parameterData || {};

      ctrl.steps = [ bindFormStep, bindParametersStep, resultsStep ];
      ctrl.hideBack = bindParametersStep.hidden;

      if (ctrl.target.kind === 'ServiceInstance') {
        ctrl.bindType = "secret-only";
        ctrl.appToBind = null;
        ctrl.serviceToBind = ctrl.target;
        if (ctrl.podPresets) {
          loadApplications();
        }
        if (ctrl.isMobileEnabled) {
          loadServiceClasses();
        }
      }
      else {
        ctrl.bindType = 'application';
        ctrl.appToBind = ctrl.target;
        loadServiceInstances();
      }
    };

    ctrl.$onChanges = function(onChangesObj) {
      if (onChangesObj.project && !onChangesObj.project.isFirstChange()) {
        ctrl.projectDisplayName = $filter('displayName')(ctrl.project);
      }
    };

    ctrl.$onDestroy = function() {
      if (selectionValidityWatcher) {
        selectionValidityWatcher();
        selectionValidityWatcher = undefined;
      }
      if (parametersValidityWatcher) {
        parametersValidityWatcher();
        parametersValidityWatcher = undefined;
      }
      if (bindingWatch) {
        DataService.unwatch(bindingWatch);
      }
    };

    var createBinding = _.bind(function(svcToBind, application, serviceClass, parameterData, bindingMeta) {
      var context = {
        namespace: _.get(svcToBind, 'metadata.namespace')
      };
      BindingService.bindService(svcToBind, application, serviceClass, parameterData, bindingMeta).then(function(binding){
        ctrl.binding = binding;
        ctrl.error = null;

        ctrl.bindCreated(ctrl.binding);

        bindingWatch = DataService.watchObject(BindingService.bindingResource, _.get(ctrl.binding, 'metadata.name'), context, function(binding) {
          ctrl.binding = binding;
        });
      }, function(e) {
        ctrl.error = e;
      });
    }, ctrl);

    var bindMobileService = _.bind(function(svcToBind, serviceClass) {
      var bindingMeta = getMobileBindingMetadata(svcToBind, serviceClass);
      createBinding(svcToBind, undefined, serviceClass, ctrl.parameterData, bindingMeta);
    }, ctrl);

    var bindService = _.bind(function(svcToBind, serviceClass) {
      var application = ctrl.bindType === 'application' ? ctrl.appToBind : undefined;
      createBinding(svcToBind, application, serviceClass, ctrl.parameterData);
    }, ctrl);

    ctrl.bindService = function() {
      var svcToBind = ctrl.target.kind === 'ServiceInstance' ? ctrl.target : ctrl.serviceToBind;
      var serviceClass = BindingService.getServiceClassForInstance(svcToBind, ctrl.serviceClasses);
      if (ctrl.isMobileEnabled && isMobileService(serviceClass)) {
        bindMobileService(svcToBind, serviceClass);  
      } else {
        bindService(svcToBind, serviceClass);
      }
    };

    ctrl.closeWizard = function() {
      if (_.isFunction(ctrl.onClose)) {
        ctrl.onClose();
      }
    };

    ctrl.bindCreated = function(binding) {
      if (_.isFunction(ctrl.onBindCreated)) {
        ctrl.onBindCreated(binding);
      }
    };
  }
})();
