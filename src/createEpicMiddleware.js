import { Subject, from, queueScheduler } from 'rxjs';
import { map, mergeMap, observeOn, subscribeOn } from 'rxjs/operators';
import { ActionsObservable } from './ActionsObservable';
import { StateObservable } from './StateObservable';

export function createEpicMiddleware(options = {}) {
  // This isn't great. RxJS doesn't publicly export the constructor for
  // QueueScheduler nor QueueAction, so we reach in. We need to do this because
  // we don't want our internal queuing mechanism to be on the same queue as any
  // other RxJS code outside of redux-observable internals.
  const QueueScheduler = queueScheduler.constructor;
  const uniqueQueueScheduler = new QueueScheduler(queueScheduler.SchedulerAction);

  if (process.env.NODE_ENV !== 'production' && typeof options === 'function') {
    throw new TypeError('Providing your root Epic to `createEpicMiddleware(rootEpic)` is no longer supported, instead use `epicMiddleware.run(rootEpic)`\n\nLearn more: https://redux-observable.js.org/MIGRATION.html#setting-up-the-middleware');
  }

  const epic$ = new Subject();
  let store;

  const epicMiddleware = _store => {
    if (process.env.NODE_ENV !== 'production' && store) {
      // https://github.com/redux-observable/redux-observable/issues/389
      require('./utils/console').warn('this middleware is already associated with a store. createEpicMiddleware should be called for every store.\n\nLearn more: https://goo.gl/2GQ7Da');
    }
    store = _store;
    const actionSubject$ = new Subject().pipe(
      observeOn(uniqueQueueScheduler)
    );
    const stateSubject$ = new Subject().pipe(
      observeOn(uniqueQueueScheduler)
    );
    const action$ = new ActionsObservable(actionSubject$);
    const state$ = new StateObservable(stateSubject$, store.getState());

    const result$ = epic$.pipe(
      map(epic => {
        let output$;

        if ('dependencies' in options && 'createDependencies' in options) {
          throw new TypeError('You have passed \'dependencies\' and \'createDependencies\' to \'createEpicMiddleware\'. You may use either one, but not both at once.');
        }

        if ('dependencies' in options) {
          output$ = epic(action$, state$, options.dependencies);
        } else if ('createDependencies' in options) {
          if (typeof options.createDependencies !== 'function') {
            throw new TypeError(`Your createDependencies option is not a function, it is '${typeof options.createDependencies}'.`);
          }

          output$ = epic(action$, state$, options.createDependencies(state$));
        } else {
          output$ = epic(action$, state$);
        }

        if (!output$) {
          throw new TypeError(`Your root Epic "${epic.name || '<anonymous>'}" does not return a stream. Double check you\'re not missing a return statement!`);
        }

        return output$;
      }),
      mergeMap(output$ =>
        from(output$).pipe(
          subscribeOn(uniqueQueueScheduler),
          observeOn(uniqueQueueScheduler)
        )
      )
    );

    result$.subscribe(store.dispatch);

    return next => {
      return action => {
        // Downstream middleware gets the action first,
        // which includes their reducers, so state is
        // updated before epics receive the action
        const result = next(action);

        // It's important to update the state$ before we emit
        // the action because otherwise it would be stale
        stateSubject$.next(store.getState());
        actionSubject$.next(action);

        return result;
      };
    };
  };

  epicMiddleware.run = rootEpic => {
    if (process.env.NODE_ENV !== 'production' && !store) {
      require('./utils/console').warn('epicMiddleware.run(rootEpic) called before the middleware has been setup by redux. Provide the epicMiddleware instance to createStore() first.');
    }
    epic$.next(rootEpic);
  };

  return epicMiddleware;
}
