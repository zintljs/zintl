<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <div class="content">
    <h1>Rsbuild with Vue</h1>
    <p>Start building amazing things with Rsbuild.</p>
    <p>Edit <code>src/components/HelloWorld.vue</code> and save to test <code>HMR</code></p>
    <button id="counter" type="button" class="counter" @click="count++">
      Count is {{ count }}
    </button>
    <nav class="nav"><router-link id="to-about" to="/about">Read the guide</router-link></nav>
  </div>
</template>
